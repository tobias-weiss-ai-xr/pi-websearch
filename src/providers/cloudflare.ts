import type { ProviderConfig, SearchArgs, SearchProvider, SearchResult } from "../types";

const BASE = "https://api.cloudflare.com/client/v4/accounts/";
const DEFAULT_GATEWAY_ID = "default";
const MAX_LIMIT = 10;

/**
 * Cloudflare Web Search API (beta) via AI Gateway.
 * Docs: https://developers.cloudflare.com/web-search/
 * Uses the ceramic backend (Cloudflare's default; cheapest per request).
 * Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 */
export function createCloudflareProvider(
  cfg: Pick<
    ProviderConfig,
    | "cloudflareApiToken"
    | "cloudflareAccountId"
    | "cloudflareGatewayId"
    | "requestTimeoutMs"
  >,
): SearchProvider {
  return {
    name: "cloudflare",
    usageNotes:
      "Cloudflare Web Search API (beta) — ceramic backend billed to AI Gateway credits. Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.",
    async search(args: SearchArgs): Promise<SearchResult[]> {
      if (!cfg.cloudflareApiToken) {
        throw new Error("cloudflare: CLOUDFLARE_API_TOKEN is not configured");
      }
      if (!cfg.cloudflareAccountId) {
        throw new Error("cloudflare: CLOUDFLARE_ACCOUNT_ID is not configured");
      }
      const url = `${BASE}${encodeURIComponent(cfg.cloudflareAccountId)}/ai/websearch/`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.cloudflareApiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: args.query,
          provider: "ceramic",
          limit: Math.min(args.numResults ?? 8, MAX_LIMIT),
          options: { gateway: { id: cfg.cloudflareGatewayId ?? DEFAULT_GATEWAY_ID } },
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(cfg.requestTimeoutMs ?? 20_000),
          ...(args.signal ? [args.signal] : []),
        ]),
      });
      if (!res.ok) throw new Error(`cloudflare: HTTP ${res.status}`);
      const data = asRecord(await res.json());
      const items = asArray(data?.items) ?? [];
      return items.map(mapItem).filter((r): r is SearchResult => r !== undefined);
    },
  };
}

function mapItem(item: unknown): SearchResult | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;
  const url = asString(rec.url);
  if (!url) return undefined;
  return {
    title: asString(rec.title) ?? url,
    url,
    snippet: asString(rec.description) ?? "",
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
