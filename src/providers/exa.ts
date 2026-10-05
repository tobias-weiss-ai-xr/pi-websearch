import type { ProviderConfig, SearchArgs, SearchProvider, SearchResult } from "../types";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

/** Largest snippet kept per result (Exa `text` can be full page content). */
const MAX_SNIPPET = 1000;

/**
 * Exa via MCP JSON-RPC over HTTP. Works anonymously; EXA_API_KEY (when
 * present) is sent as the X-API-Key header. The HTTP body may be plain JSON
 * or an SSE envelope, and the inner content text may be JSON or plain text —
 * all parsed defensively.
 */
export function createExaProvider(
  cfg: Pick<ProviderConfig, "exaApiKey" | "requestTimeoutMs">,
): SearchProvider {
  return {
    name: "exa",
    usageNotes:
      "Default provider. Neural+keyword web search with clean snippets; works without an API key (rate-limited anonymously).",
    async search(args: SearchArgs): Promise<SearchResult[]> {
      const res = await fetch(EXA_MCP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(cfg.exaApiKey ? { "x-api-key": cfg.exaApiKey } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "web_search_exa",
            arguments: {
              query: args.query,
              numResults: args.numResults ?? 8,
              type: args.type ?? "auto",
              ...(args.dateRange ? { dateRange: args.dateRange } : {}),
            },
          },
          id: 1,
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(cfg.requestTimeoutMs ?? 20_000),
          ...(args.signal ? [args.signal] : []),
        ]),
      });
      if (!res.ok) throw new Error(`exa: HTTP ${res.status}`);
      return parseExaResponse(parseSseOrJson(await res.text()));
    },
  };
}

/** Parse an HTTP body that may be plain JSON or an SSE envelope. */
function parseSseOrJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  // SSE: scan data: lines back-to-front for the last parseable JSON payload.
  for (const line of trimmed.split(/\r?\n/).reverse()) {
    if (!line.startsWith("data:")) continue;
    try {
      return JSON.parse(line.slice(5).trim());
    } catch {
      // not JSON — keep scanning
    }
  }
  return trimmed;
}

/** Extract results from a JSON-RPC response (or raw text). */
function parseExaResponse(payload: unknown): SearchResult[] {
  if (typeof payload === "string") return parseExaContent(payload);
  const rec = asRecord(payload);
  if (!rec) return [];
  const error = asRecord(rec.error);
  if (error) {
    throw new Error(`exa: JSON-RPC error ${asString(error.message) ?? "unknown"}`);
  }
  const content = asArray(asRecord(rec.result)?.content);
  const text = content?.map((item) => asString(asRecord(item)?.text)).find(Boolean);
  return text ? parseExaContent(text) : [];
}

/** Parse content[0].text — may be a JSON results array/object or plain text. */
function parseExaContent(text: string): SearchResult[] {
  const trimmed = text.trim();
  let parsed: unknown;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = undefined;
    }
  }
  if (parsed !== undefined) {
    const list = asArray(parsed) ?? asArray(asRecord(parsed)?.results) ?? [];
    const results = list
      .map(mapExaItem)
      .filter((r): r is SearchResult => r !== undefined);
    if (results.length > 0) return results;
  }
  // Plain text payload → single pseudo-result so the text still reaches the LLM.
  return [
    {
      title: trimmed.split(/\r?\n/, 1)[0]?.slice(0, 120) || "Exa result",
      url: "",
      snippet: trimmed,
    },
  ];
}

function mapExaItem(item: unknown): SearchResult | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;
  const url = asString(rec.url) ?? "";
  const snippet =
    asString(rec.summary) ?? asString(rec.text) ?? asString(rec.snippet) ?? "";
  const publishedDate = asString(rec.publishedDate);
  const highlights = asArray(rec.highlights)?.map(asString).filter(
    (s): s is string => s !== undefined,
  );
  return {
    title: asString(rec.title) || url || "(untitled)",
    url,
    snippet: snippet.slice(0, MAX_SNIPPET),
    ...(highlights && highlights.length > 0 ? { highlights } : {}),
    ...(publishedDate ? { publishedDate } : {}),
  };
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
