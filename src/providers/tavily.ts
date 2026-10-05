import type { ProviderConfig, SearchArgs, SearchProvider, SearchResult } from "../types";

/**
 * Tavily Search API (requires TAVILY_API_KEY, sent in the request body).
 */
export function createTavilyProvider(
  cfg: Pick<ProviderConfig, "tavilyApiKey" | "requestTimeoutMs">,
): SearchProvider {
  return {
    name: "tavily",
    usageNotes:
      "Tavily — LLM-oriented search with clean content extraction. Requires TAVILY_API_KEY.",
    async search(args: SearchArgs): Promise<SearchResult[]> {
      if (!cfg.tavilyApiKey) {
        throw new Error("tavily: TAVILY_API_KEY is not configured");
      }
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: cfg.tavilyApiKey,
          query: args.query,
          max_results: args.numResults ?? 8,
          ...(args.type === "deep" ? { search_depth: "advanced" } : {}),
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(cfg.requestTimeoutMs ?? 20_000),
          ...(args.signal ? [args.signal] : []),
        ]),
      });
      if (!res.ok) throw new Error(`tavily: HTTP ${res.status}`);
      const results = asArray(asRecord(await res.json())?.results) ?? [];
      return results
        .map(mapItem)
        .filter((r): r is SearchResult => r !== undefined);
    },
  };
}

function mapItem(item: unknown): SearchResult | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;
  const url = asString(rec.url);
  if (!url) return undefined;
  const publishedDate = asString(rec.published_date);
  return {
    title: asString(rec.title) || url,
    url,
    snippet: asString(rec.content) ?? "",
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
