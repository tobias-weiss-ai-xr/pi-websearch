import type { ProviderConfig, SearchArgs, SearchProvider, SearchResult } from "../types";

/**
 * Google Programmable Search (Custom Search JSON API; requires GOOGLE_API_KEY
 * + GOOGLE_CX). `num` is capped at 10 by the API.
 */
export function createGoogleProvider(
  cfg: Pick<ProviderConfig, "googleApiKey" | "googleCx" | "requestTimeoutMs">,
): SearchProvider {
  return {
    name: "google",
    usageNotes:
      "Google CSE — highest result quality for many queries. Requires GOOGLE_API_KEY and GOOGLE_CX; daily quota limits apply.",
    async search(args: SearchArgs): Promise<SearchResult[]> {
      if (!cfg.googleApiKey || !cfg.googleCx) {
        throw new Error("google: GOOGLE_API_KEY and GOOGLE_CX are not configured");
      }
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", cfg.googleApiKey);
      url.searchParams.set("cx", cfg.googleCx);
      url.searchParams.set("q", args.query);
      url.searchParams.set("num", String(Math.min(args.numResults ?? 8, 10)));
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.any([
          AbortSignal.timeout(cfg.requestTimeoutMs ?? 20_000),
          ...(args.signal ? [args.signal] : []),
        ]),
      });
      if (!res.ok) throw new Error(`google: HTTP ${res.status}`);
      const items = asArray(asRecord(await res.json())?.items) ?? [];
      return results(items);
    },
  };
}

function results(items: unknown[]): SearchResult[] {
  return items.map(mapItem).filter((r): r is SearchResult => r !== undefined);
}

function mapItem(item: unknown): SearchResult | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;
  const url = asString(rec.link);
  if (!url) return undefined;
  return {
    title: asString(rec.title) || url,
    url,
    snippet: asString(rec.snippet) ?? "",
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
