import type { ProviderConfig, SearchArgs, SearchProvider, SearchResult } from "../types";

/** dateRange strings SearXNG understands via its `time_range` param. */
const TIME_RANGES: Record<string, string> = {
  day: "day",
  past_day: "day",
  week: "week",
  past_week: "week",
  month: "month",
  past_month: "month",
  year: "year",
  past_year: "year",
};

/**
 * Self-hosted SearXNG metasearch via its JSON API
 * (GET {base}/search?q=…&format=json). Basic-auth credentials embedded in
 * SEARXNG_BASE_URL (http://user:pass@host) are moved into an Authorization
 * header. Requires `format=json` to be enabled on the instance.
 */
export function createSearxngProvider(
  cfg: Pick<ProviderConfig, "searxngBaseUrl" | "requestTimeoutMs">,
): SearchProvider {
  return {
    name: "searxng",
    usageNotes:
      "Self-hosted, fully private metasearch. Requires SEARXNG_BASE_URL with the JSON format enabled.",
    async search(args: SearchArgs): Promise<SearchResult[]> {
      if (!cfg.searxngBaseUrl) {
        throw new Error("searxng: SEARXNG_BASE_URL is not configured");
      }
      const url = new URL(cfg.searxngBaseUrl);
      // Credentials in the URL → Authorization header (fetch won't send them).
      let authorization: string | undefined;
      if (url.username) {
        authorization = `Basic ${btoa(
          `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
        )}`;
        url.username = "";
        url.password = "";
      }
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/search`;
      url.searchParams.set("q", args.query);
      url.searchParams.set("format", "json");
      const timeRange = args.dateRange && TIME_RANGES[args.dateRange.toLowerCase()];
      if (timeRange) url.searchParams.set("time_range", timeRange);

      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(authorization ? { authorization } : {}),
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(cfg.requestTimeoutMs ?? 20_000),
          ...(args.signal ? [args.signal] : []),
        ]),
      });
      if (!res.ok) throw new Error(`searxng: HTTP ${res.status}`);
      const results = asArray(asRecord(await res.json())?.results) ?? [];
      return results
        .map(mapItem)
        .filter((r): r is SearchResult => r !== undefined)
        .slice(0, args.numResults ?? 8);
    },
  };
}

function mapItem(item: unknown): SearchResult | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;
  const url = asString(rec.url);
  if (!url) return undefined;
  const publishedDate = asString(rec.publishedDate);
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
