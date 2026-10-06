import { afterEach, describe, expect, test } from "bun:test";
import type { ProviderConfig, SearchResult } from "../src/types";
import { createBraveProvider } from "../src/providers/brave";
import { createCloudflareProvider } from "../src/providers/cloudflare";
import { createDuckduckgoProvider } from "../src/providers/duckduckgo";
import { createExaProvider } from "../src/providers/exa";
import { createGoogleProvider } from "../src/providers/google";
import { createSearxngProvider } from "../src/providers/searxng";
import { createTavilyProvider } from "../src/providers/tavily";
import { createProvider, searchWithFallback } from "../src/lib/providers";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

const SEARCH = { query: "bun runtime", numResults: 5, type: "auto" as const };

// ---------------------------------------------------------------------------
// Exa MCP
// ---------------------------------------------------------------------------

const EXA_INNER = JSON.stringify({
  results: [
    {
      title: "Bun — The Fast Runtime",
      url: "https://bun.sh",
      text: "Bun is a fast JavaScript runtime.",
      highlights: ["fast", "runtime"],
      publishedDate: "2025-01-01",
    },
    { title: "Second", url: "https://example.com/2" },
  ],
});

const EXA_RPC = {
  jsonrpc: "2.0",
  id: 1,
  result: { content: [{ type: "text", text: EXA_INNER }] },
};

describe("exa provider", () => {
  test("posts JSON-RPC to the MCP endpoint with query and key header", async () => {
    const { calls } = mockFetch(() => jsonResponse(EXA_RPC));
    const results = await createExaProvider({
      exaApiKey: "k-123",
      requestTimeoutMs: 1000,
    }).search(SEARCH);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mcp.exa.ai/mcp");
    expect(calls[0].init?.method).toBe("POST");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-api-key")).toBe("k-123");
    const body = JSON.parse(String(calls[0].init?.body)) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    };
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("web_search_exa");
    expect(body.params.arguments.query).toBe("bun runtime");
    expect(body.params.arguments.numResults).toBe(5);
    expect(body.params.arguments.type).toBe("auto");
    expect(results).toHaveLength(2);
  });

  test("omits the API key header when none configured", async () => {
    const { calls } = mockFetch(() => jsonResponse(EXA_RPC));
    await createExaProvider({ requestTimeoutMs: 1000 }).search(SEARCH);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-api-key")).toBeNull();
  });

  test("parses an SSE envelope response", async () => {
    mockFetch(
      () =>
        new Response(
          `event: message\ndata: ${JSON.stringify(EXA_RPC)}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const results = await createExaProvider({ requestTimeoutMs: 1000 }).search(SEARCH);
    expect(results[0]?.url).toBe("https://bun.sh");
    expect(results[0]?.highlights).toEqual(["fast", "runtime"]);
  });

  test("falls back to a single pseudo-result for plain-text content", async () => {
    mockFetch(
      () =>
        jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "Just some prose answer." }] },
        }),
    );
    const results = await createExaProvider({ requestTimeoutMs: 1000 }).search(SEARCH);
    expect(results).toHaveLength(1);
    expect(results[0]?.snippet).toBe("Just some prose answer.");
  });

  test("non-2xx response throws", async () => {
    mockFetch(() => new Response("rate limited", { status: 429 }));
    await expect(
      createExaProvider({ requestTimeoutMs: 1000 }).search(SEARCH),
    ).rejects.toThrow("HTTP 429");
  });
});

// ---------------------------------------------------------------------------
// SearXNG
// ---------------------------------------------------------------------------

describe("searxng provider", () => {
  test("builds the JSON API URL and maps results", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({
        results: [
          { title: "Hit", url: "https://x.example", content: "content here" },
          { url: "https://no-title.example", content: "" },
          { title: "no url", content: "dropped" },
        ],
      }),
    );
    const results = await createSearxngProvider({
      searxngBaseUrl: "http://localhost:8080/searxng",
      requestTimeoutMs: 1000,
    }).search(SEARCH);
    expect(calls[0].url).toContain("http://localhost:8080/searxng/search?q=");
    expect(calls[0].url).toContain("format=json");
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Hit",
      url: "https://x.example",
      snippet: "content here",
    });
    expect(results[1]?.title).toBe("https://no-title.example");
  });

  test("moves URL userinfo into an Authorization header", async () => {
    const { calls } = mockFetch(() => jsonResponse({ results: [] }));
    await createSearxngProvider({
      searxngBaseUrl: "http://user:pass@searx.internal:8080",
      requestTimeoutMs: 1000,
    }).search(SEARCH);
    expect(calls[0].url.startsWith("http://searx.internal:8080/search")).toBe(true);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe(`Basic ${btoa("user:pass")}`);
  });

  test("missing base URL throws before any fetch", async () => {
    mockFetch(() => jsonResponse({ results: [] }));
    await expect(
      createSearxngProvider({ requestTimeoutMs: 1000 }).search(SEARCH),
    ).rejects.toThrow("SEARXNG_BASE_URL");
  });
});

// ---------------------------------------------------------------------------
// DuckDuckGo
// ---------------------------------------------------------------------------

const DDG_HTML = `<html><body><table>
<tr><td>1.&nbsp;</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x" class="result-link">Example &amp; Co</a></td></tr>
<tr><td class="result-snippet">A &quot;quoted&quot; snippet &lt;b&gt;here&lt;/b&gt;</td></tr>
<tr><td>2.&nbsp;</td><td><a rel="nofollow" href="https://example.com/b" class='result-link'>Second</a></td></tr>
<tr><td class='result-snippet'>Second snippet</td></tr>
</table></body></html>`;

describe("duckduckgo provider", () => {
  test("parses links + snippets, unwraps redirects, decodes entities", async () => {
    const { calls } = mockFetch(() => new Response(DDG_HTML, { status: 200 }));
    const results = await createDuckduckgoProvider({
      requestTimeoutMs: 1000,
    }).search(SEARCH);
    expect(calls[0].url).toBe(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent("bun runtime")}`,
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Example & Co",
      url: "https://example.com/a",
      snippet: `A "quoted" snippet here`,
    });
    expect(results[1]).toEqual({
      title: "Second",
      url: "https://example.com/b",
      snippet: "Second snippet",
    });
  });

  test("empty / bot-wall HTML yields zero results", async () => {
    mockFetch(() => new Response("<html><body>Anomaly detected</body></html>"));
    const results = await createDuckduckgoProvider({
      requestTimeoutMs: 1000,
    }).search(SEARCH);
    expect(results).toEqual([]);
  });

  test("HTTP error throws", async () => {
    mockFetch(() => new Response("nope", { status: 403 }));
    await expect(
      createDuckduckgoProvider({ requestTimeoutMs: 1000 }).search(SEARCH),
    ).rejects.toThrow("HTTP 403");
  });
});

// ---------------------------------------------------------------------------
// Brave
// ---------------------------------------------------------------------------

describe("brave provider", () => {
  test("sends subscription token and maps web.results", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({
        data: {
          web: {
            results: [
              {
                title: "Brave hit",
                url: "https://brave.example",
                description: "Brave description",
                extra_snippets: ["extra1", "extra2"],
                age: "2 days ago",
              },
            ],
          },
        },
      }),
    );
    const results = await createBraveProvider({
      braveApiKey: "brk",
      requestTimeoutMs: 1000,
    }).search(SEARCH);
    expect(calls[0].url).toContain("https://api.search.brave.com/res/v1/web/search?q=");
    expect(calls[0].url).toContain("count=5");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-subscription-token")).toBe("brk");
    expect(results).toHaveLength(1);
    expect(results[0]?.snippet).toBe("Brave description");
    expect(results[0]?.highlights).toEqual(["extra1", "extra2"]);
    expect(results[0]?.publishedDate).toBe("2 days ago");
  });

  test("missing key throws before any fetch", async () => {
    await expect(
      createBraveProvider({ requestTimeoutMs: 1000 }).search(SEARCH),
    ).rejects.toThrow("BRAVE_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// Tavily
// ---------------------------------------------------------------------------

describe("tavily provider", () => {
  test("posts api_key/query/max_results and maps content", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({
        results: [
          {
            title: "Tavily hit",
            url: "https://tavily.example",
            content: "Tavily content",
            published_date: "2025-06-01",
          },
        ],
      }),
    );
    const results = await createTavilyProvider({
      tavilyApiKey: "tvly",
      requestTimeoutMs: 1000,
    }).search(SEARCH);
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.api_key).toBe("tvly");
    expect(body.query).toBe("bun runtime");
    expect(body.max_results).toBe(5);
    expect(results[0]?.snippet).toBe("Tavily content");
    expect(results[0]?.publishedDate).toBe("2025-06-01");
  });

  test("missing key throws before any fetch", async () => {
    await expect(
      createTavilyProvider({ requestTimeoutMs: 1000 }).search(SEARCH),
    ).rejects.toThrow("TAVILY_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// Google CSE
// ---------------------------------------------------------------------------

describe("google provider", () => {
  test("builds the CSE URL and maps items", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({
        items: [
          { title: "Google hit", link: "https://google.example", snippet: "Google snippet" },
          { title: "no link", snippet: "dropped" },
        ],
      }),
    );
    const results = await createGoogleProvider({
      googleApiKey: "gk",
      googleCx: "cx-1",
      requestTimeoutMs: 1000,
    }).search({ ...SEARCH, numResults: 20 });
    const params = new URL(calls[0].url).searchParams;
    expect(params.get("key")).toBe("gk");
    expect(params.get("cx")).toBe("cx-1");
    expect(params.get("q")).toBe("bun runtime");
    // API caps num at 10.
    expect(params.get("num")).toBe("10");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Google hit",
      url: "https://google.example",
      snippet: "Google snippet",
    });
  });

  test("missing key/cx throws before any fetch", async () => {
    await expect(
      createGoogleProvider({ requestTimeoutMs: 1000 }).search(SEARCH),
    ).rejects.toThrow("GOOGLE_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// Cloudflare Web Search API
// ---------------------------------------------------------------------------

describe("cloudflare provider", () => {
  test("posts to the websearch endpoint with bearer token and gateway", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse({
        items: [
          { url: "https://cf.example/a", title: "CF hit", description: "CF desc" },
          { url: "https://cf.example/b" },
          { title: "no url, drop me" },
        ],
      }),
    );
    const results = await createCloudflareProvider({
      cloudflareApiToken: "cf-tok",
      cloudflareAccountId: "acc-123",
      cloudflareGatewayId: "my-gw",
      requestTimeoutMs: 1000,
    }).search(SEARCH);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc-123/ai/websearch/",
    );
    expect(calls[0].init?.method).toBe("POST");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer cf-tok");
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.query).toBe("bun runtime");
    expect(body.provider).toBe("ceramic");
    expect(body.limit).toBe(5);
    expect(body.options).toEqual({ gateway: { id: "my-gw" } });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "CF hit",
      url: "https://cf.example/a",
      snippet: "CF desc",
    });
    expect(results[1]?.title).toBe("https://cf.example/b");
  });

  test("caps limit at 10 and defaults gateway to 'default'", async () => {
    const { calls } = mockFetch(() => jsonResponse({ items: [] }));
    await createCloudflareProvider({
      cloudflareApiToken: "t",
      cloudflareAccountId: "a",
      requestTimeoutMs: 1000,
    }).search({ ...SEARCH, numResults: 99 });
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.limit).toBe(10);
    const options = body.options as { gateway: { id: string } };
    expect(options.gateway.id).toBe("default");
  });

  test("missing token or account id throws before any fetch", async () => {
    mockFetch(() => jsonResponse({ items: [] }));
    await expect(
      createCloudflareProvider({ requestTimeoutMs: 1000 }).search(SEARCH),
    ).rejects.toThrow("CLOUDFLARE_API_TOKEN");
    await expect(
      createCloudflareProvider({
        cloudflareApiToken: "t",
        requestTimeoutMs: 1000,
      }).search(SEARCH),
    ).rejects.toThrow("CLOUDFLARE_ACCOUNT_ID");
  });
});

// ---------------------------------------------------------------------------
// Provider registry + fallback chain
// ---------------------------------------------------------------------------

const RESULT_A: SearchResult[] = [{ title: "A", url: "https://a", snippet: "a" }];
const RESULT_B: SearchResult[] = [{ title: "B", url: "https://b", snippet: "b" }];

describe("provider registry", () => {
  test("explicit configured provider is primary with exa/ddg fallbacks", () => {
    const chain = createProvider(cfg({ provider: "brave", braveApiKey: "k" }));
    expect(chain.primary.name).toBe("brave");
    expect(chain.fallbacks.map((p) => p.name)).toEqual(["exa", "duckduckgo"]);
  });

  test("exa primary does not repeat itself in fallbacks", () => {
    const chain = createProvider(cfg({ provider: "exa" }));
    expect(chain.primary.name).toBe("exa");
    expect(chain.fallbacks.map((p) => p.name)).toEqual(["duckduckgo"]);
  });

  test("auto-picks the first available keyed provider when configured one lacks keys", () => {
    const chain = createProvider(cfg({ provider: "brave", tavilyApiKey: "t" }));
    expect(chain.primary.name).toBe("tavily");
    expect(chain.fallbacks.map((p) => p.name)).toEqual(["exa", "duckduckgo"]);
  });

  test("falls back to exa when nothing keyed is available", () => {
    const chain = createProvider(cfg({ provider: "google" }));
    expect(chain.primary.name).toBe("exa");
  });

  test("auto-picks cloudflare last among keyed providers", () => {
    const chain = createProvider(cfg({
      provider: "brave",
      cloudflareApiToken: "t",
      cloudflareAccountId: "a",
    }));
    expect(chain.primary.name).toBe("cloudflare");
  });
});

describe("searchWithFallback", () => {
  function fakeChain(
    behaviors: {
      name: string;
      outcome: "ok" | "empty" | "throw";
      results?: SearchResult[];
    }[],
  ) {
    const providers = behaviors.map((b) => ({
      name: b.name,
      search: async (): Promise<SearchResult[]> => {
        if (b.outcome === "throw") throw new Error(`${b.name} exploded`);
        return b.outcome === "empty" ? [] : (b.results ?? []);
      },
    }));
    const [primary, ...fallbacks] = providers;
    return { primary, fallbacks };
  }

  test("primary success is served and reported", async () => {
    const chain = fakeChain([
      { name: "primary", outcome: "ok", results: RESULT_A },
      { name: "backup", outcome: "ok", results: RESULT_B },
    ]);
    const { results, provider } = await searchWithFallback(chain, SEARCH);
    expect(provider).toBe("primary");
    expect(results).toEqual(RESULT_A);
  });

  test("primary failure moves to the next provider and reports it", async () => {
    const chain = fakeChain([
      { name: "primary", outcome: "throw" },
      { name: "exa", outcome: "ok", results: RESULT_B },
    ]);
    const { results, provider } = await searchWithFallback(chain, SEARCH);
    expect(provider).toBe("exa");
    expect(results).toEqual(RESULT_B);
  });

  test("empty primary result also falls through", async () => {
    const chain = fakeChain([
      { name: "primary", outcome: "empty" },
      { name: "backup", outcome: "ok", results: RESULT_B },
    ]);
    const { results, provider } = await searchWithFallback(chain, SEARCH);
    expect(provider).toBe("backup");
    expect(results).toEqual(RESULT_B);
  });

  test("all providers failing never throws", async () => {
    const chain = fakeChain([
      { name: "a", outcome: "throw" },
      { name: "b", outcome: "empty" },
      { name: "c", outcome: "throw" },
    ]);
    const { results, provider } = await searchWithFallback(chain, SEARCH);
    expect(provider).toBe("none");
    expect(results).toEqual([]);
  });
});
