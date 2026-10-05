import { afterEach, describe, expect, test } from "bun:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * Drop-in parity contract: importing the extension entrypoint and simulating
 * session_start must register the FULL tool-name surface used by the replaced
 * extensions — WebSearch (@mammothb), websearch (@alfonzjanfrithz),
 * web_search (pi-web-search), webfetch + fetch_content (webfetch /
 * xz-pi-websearch) — with no duplicates, and every registered tool must be
 * executable. Prompts/skills that reference any of these names keep working.
 */

// ---------------------------------------------------------------------------
// hermetic fetch mock — no live endpoints
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

function exaJsonResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify([
              {
                title: "Drop-in parity result",
                url: "https://example.com/parity",
                text: "All five tool names respond.",
              },
            ]),
          },
        ],
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

/** Exa MCP URL → JSON-RPC result; anything else → DDG-lite-style HTML. */
function mockFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("mcp.exa.ai")) return exaJsonResponse();
    return new Response(
      `<html><body>` +
        `<a class="result-link" href="https://example.com/fallback">Fallback result</a>` +
        `<td class="result-snippet">Served by the keyless fallback</td>` +
        `</body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// extension harness — real factory, stub pi API
// ---------------------------------------------------------------------------

const EXPECTED_NAMES = [
  "WebSearch",
  "websearch",
  "web_search",
  "webfetch",
  "fetch_content",
] as const;

const SEARCH_NAMES = ["WebSearch", "websearch", "web_search"] as const;
const FETCH_NAMES = ["webfetch", "fetch_content"] as const;

/** Run the real factory + session_start; return the registered tool defs. */
async function sessionStart(): Promise<ToolDefinition[]> {
  const { default: factory } = await import("../src/index.ts");
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, (event: unknown, ctx: unknown) => Promise<void>> = {};
  factory({
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<void>,
    ) => {
      handlers[event] = handler;
    },
    registerTool: (tool: ToolDefinition) => tools.push(tool),
  } as never);

  expect(handlers["session_start"]).toBeDefined();
  await handlers["session_start"]({ type: "session_start" }, {
    ui: { notify: () => undefined },
  } as never);
  return tools;
}

async function executeTool(
  tool: ToolDefinition,
  params: Record<string, unknown>,
): Promise<string> {
  const result = await tool.execute(
    "dropin-test",
    params as never,
    undefined,
    undefined,
    undefined as never,
  );
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// the drop-in contract
// ---------------------------------------------------------------------------

describe("drop-in parity", () => {
  test("registers exactly the five drop-in tool names, no duplicates", async () => {
    mockFetch();
    const tools = await sessionStart();
    const names = tools.map((t) => t.name);

    expect([...names].sort()).toEqual([...EXPECTED_NAMES].sort());
    expect(new Set(names).size).toBe(names.length); // no duplicates
    // All five are real ToolDefinitions: executable, labeled, described.
    for (const tool of tools) {
      expect(typeof tool.execute).toBe("function");
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  test("search aliases expose the shared search schema and execute", async () => {
    mockFetch();
    const tools = await sessionStart();

    for (const name of SEARCH_NAMES) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `tool ${name} registered`).toBeDefined();
      expect(tool!.parameters.required).toContain("query");
      const text = await executeTool(tool!, { query: "drop-in parity" });
      expect(text).toContain("Drop-in parity result");
      expect(text).toContain("https://example.com/parity");
    }
  });

  test("fetch aliases expose the url schema and execute", async () => {
    mockFetch();
    const tools = await sessionStart();

    for (const name of FETCH_NAMES) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `tool ${name} registered`).toBeDefined();
      expect(tool!.parameters.required).toContain("url");
      const text = await executeTool(tool!, { url: "https://example.com/doc" });
      expect(text).toContain("Fallback result");
    }
  });

  test("search aliases respond on the fallback chain when the primary fails", async () => {
    // Primary (exa) down → keyless duckduckgo must still answer every alias.
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("mcp.exa.ai")) return new Response("boom", { status: 500 });
      return new Response(
        `<a class="result-link" href="https://example.com/fallback">Fallback result</a>` +
          `<td class="result-snippet">keyless fallback</td>`,
        { headers: { "content-type": "text/html" } },
      );
    }) as typeof fetch;
    const tools = await sessionStart();

    for (const name of SEARCH_NAMES) {
      const tool = tools.find((t) => t.name === name)!;
      const text = await executeTool(tool, { query: "still works" });
      expect(text).toContain("Fallback result");
    }
  });
});
