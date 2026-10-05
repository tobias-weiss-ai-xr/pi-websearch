import { afterEach, describe, expect, test } from "bun:test";
import type { ProviderConfig } from "../src/types";
import { formatResults } from "../src/websearch";
import { createWebsearchTool } from "../src/websearch";
import { createWebfetchTool } from "../src/webfetch";
import type { SearchResult } from "../src/types";

// ---------------------------------------------------------------------------
// fetch mocking (hermetic — no live endpoints)
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

interface Call {
  url: string;
  init?: RequestInit;
}

type Handler = (call: Call) => Response | Promise<Response>;

function mockFetch(handler: Handler): { calls: Call[] } {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function cfg(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    provider: "exa",
    numResults: 8,
    type: "auto",
    contextMaxCharacters: 10_000,
    cacheTtlSeconds: 300,
    requestTimeoutMs: 1000,
    ...overrides,
  };
}

function exaBody(results: Array<Partial<SearchResult>>): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            results.map((r) => ({
              title: r.title ?? "T",
              url: r.url ?? "https://example.com",
              text: r.snippet ?? "snippet",
              ...(r.highlights ? { highlights: r.highlights } : {}),
            })),
          ),
        },
      ],
    },
  };
}

const RESULT = { id: "t1" };
const NOOP_CTX = undefined as never;

async function execSearch(
  tool: ReturnType<typeof createWebsearchTool>,
  params: Record<string, unknown>,
) {
  return tool.execute(RESULT.id, params as never, undefined, undefined, NOOP_CTX);
}

// ---------------------------------------------------------------------------
// websearch tool
// ---------------------------------------------------------------------------

describe("websearch tool", () => {
  test("executes and renders Title/URL/snippet blocks", async () => {
    const { calls } = mockFetch(() =>
      new Response(
        JSON.stringify(
          exaBody([
            { title: "Bun docs", url: "https://bun.sh/docs", snippet: "Fast all-in-one" },
          ]),
        ),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const tool = createWebsearchTool(cfg());
    const res = await execSearch(tool, { query: "bun runtime" });
    expect(calls.length).toBe(1);
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    expect(text).toContain("Bun docs");
    expect(text).toContain("https://bun.sh/docs");
    expect(text).toContain("Fast all-in-one");
  });

  test("cache: second identical call hits cache, fetch called once", async () => {
    const { calls } = mockFetch(() =>
      new Response(JSON.stringify(exaBody([{ title: "x", url: "https://x", snippet: "y" }])), {
        headers: { "content-type": "application/json" },
      }),
    );
    const tool = createWebsearchTool(cfg());
    const first = await execSearch(tool, { query: "cached query" });
    const second = await execSearch(tool, { query: "cached query" });
    expect(calls.length).toBe(1);
    expect(first.details).toMatchObject({ cached: false, provider: "exa" });
    expect(second.details).toMatchObject({ cached: true, resultCount: 1 });
    const t1 = first.content[0].type === "text" ? first.content[0].text : "";
    const t2 = second.content[0].type === "text" ? second.content[0].text : "";
    expect(t2).toBe(t1);
  });

  test("fallback: primary failure falls through and provider name is surfaced", async () => {
    const seen: string[] = [];
    mockFetch((call) => {
      seen.push(call.url);
      if (call.url.includes("mcp.exa.ai")) {
        return new Response("boom", { status: 500 });
      }
      // duckduckgo lite HTML
      return new Response(
        `<a class="result-link" href="https://example.com">Example</a>` +
          `<td class="result-snippet">An example page</td>`,
        { status: 200 },
      );
    });
    const tool = createWebsearchTool(cfg({ provider: "exa" }));
    const res = await execSearch(tool, { query: "fallback please" });
    expect(seen.length).toBe(2); // exa failed, duckduckgo served
    expect(res.details).toMatchObject({ provider: "duckduckgo", resultCount: 1 });
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    expect(text).toContain("Example");
    expect(text).toContain("https://example.com");
  });

  test("empty query throws", async () => {
    mockFetch(() => new Response("{}", { status: 200 }));
    const tool = createWebsearchTool(cfg());
    await expect(execSearch(tool, { query: "   " })).rejects.toThrow(/query/);
  });

  test("formatResults truncates to contextMaxCharacters", () => {
    const results: SearchResult[] = Array.from({ length: 50 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      snippet: "lorem ipsum dolor sit amet ".repeat(10),
    }));
    const { text, truncated } = formatResults(results, 1000);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(truncated).toBe(true);
    expect(text).toContain("Result 0");
    const full = formatResults(results.slice(0, 1), 10_000);
    expect(full.truncated).toBe(false);
    expect(full.text).toBe(
      "Result 0\nhttps://example.com/0\n" + "lorem ipsum dolor sit amet ".repeat(10).trim(),
    );
  });
});

// ---------------------------------------------------------------------------
// webfetch tool
// ---------------------------------------------------------------------------

describe("webfetch tool", () => {
  test("fetches HTML and truncates to maxCharacters", async () => {
    const big = "<html><body><p>" + "word ".repeat(5000) + "</p></body></html>";
    const { calls } = mockFetch(() =>
      new Response(big, { headers: { "content-type": "text/html" } }),
    );
    const tool = createWebfetchTool();
    const res = await tool.execute(
      RESULT.id,
      { url: "https://example.com/page", maxCharacters: 500 } as never,
      undefined,
      undefined,
      NOOP_CTX,
    );
    expect(calls.length).toBe(1);
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    expect(text.length).toBeLessThanOrEqual(520); // 500 + marker
    expect(text).toContain("[… truncated]");
    expect(res.details).toMatchObject({ truncated: true, status: 200 });
  });

  test("rejects non-http URLs", async () => {
    mockFetch(() => new Response("", { status: 200 }));
    const tool = createWebfetchTool();
    await expect(
      tool.execute(RESULT.id, { url: "file:///etc/passwd" } as never, undefined, undefined, NOOP_CTX),
    ).rejects.toThrow(/http/);
  });

  test("HTTP errors throw", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    const tool = createWebfetchTool();
    await expect(
      tool.execute(RESULT.id, { url: "https://example.com/404" } as never, undefined, undefined, NOOP_CTX),
    ).rejects.toThrow(/404/);
  });
});

// ---------------------------------------------------------------------------
// index wiring
// ---------------------------------------------------------------------------

describe("index wiring", () => {
  test("registers all drop-in tool names on session_start", async () => {
    const { default: factory } = await import("../src/index.ts");
    const names: string[] = [];
    const handlers: Record<string, (e: unknown, ctx: unknown) => Promise<void>> = {};
    factory({
      on: (event: string, handler: (e: unknown, ctx: unknown) => Promise<void>) => {
        handlers[event] = handler;
      },
      registerTool: (tool: { name: string }) => names.push(tool.name),
    } as never);

    expect(handlers["session_start"]).toBeDefined();
    expect(handlers["session_shutdown"]).toBeDefined();

    let notified = "";
    await handlers["session_start"](
      { type: "session_start", reason: "startup" },
      { ui: { notify: (msg: string) => (notified = msg) } },
    );
    expect([...names].sort()).toEqual([
      "WebSearch",
      "fetch_content",
      "web_search",
      "webfetch",
      "websearch",
    ]);
    expect(notified).toContain("pi-websearch ready");

    // shutdown handler is idempotent
    await handlers["session_shutdown"]({ type: "session_shutdown", reason: "quit" }, {});
    await handlers["session_shutdown"]({ type: "session_shutdown", reason: "quit" }, {});
  });
});
