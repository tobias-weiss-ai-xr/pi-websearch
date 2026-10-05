import type { ProviderConfig, SearchArgs, SearchProvider, SearchResult } from "../types";

/**
 * Brave Search API (requires BRAVE_API_KEY, sent as X-Subscription-Token).
 */
export function createBraveProvider(
  cfg: Pick<ProviderConfig, "braveApiKey" | "requestTimeoutMs">,
): SearchProvider {
  return {
    name: "brave",
    usageNotes:
      "Brave Search API — independent index, good privacy posture. Requires BRAVE_API_KEY.",
    async search(args: SearchArgs): Promise<SearchResult[]> {
      if (!cfg.braveApiKey) {
        throw new Error("brave: BRAVE_API_KEY is not configured");
      }
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", args.query);
      // Brave caps count at 20.
      url.searchParams.set("count", String(Math.min(args.numResults ?? 8, 20)));
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "x-subscription-token": cfg.braveApiKey,
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(cfg.requestTimeoutMs ?? 20_000),
          ...(args.signal ? [args.signal] : []),
        ]),
      });
      if (!res.ok) throw new Error(`brave: HTTP ${res.status}`);
      const web = asRecord(asRecord(asRecord(await res.json())?.data)?.web);
      const results = asArray(web?.results) ?? [];
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
  const age = asString(rec.age);
  const highlights = asArray(rec.extra_snippets)?.map(asString).filter(
    (s): s is string => s !== undefined,
  );
  return {
    title: asString(rec.title) || url,
    url,
    snippet: asString(rec.description) ?? "",
    ...(highlights && highlights.length > 0 ? { highlights } : {}),
    ...(age ? { publishedDate: age } : {}),
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
