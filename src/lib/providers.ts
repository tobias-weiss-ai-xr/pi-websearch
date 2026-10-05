import type {
  ProviderConfig,
  ProviderId,
  SearchArgs,
  SearchProvider,
  SearchResult,
} from "../types";
import { createBraveProvider } from "../providers/brave";
import { createDuckduckgoProvider } from "../providers/duckduckgo";
import { createExaProvider } from "../providers/exa";
import { createGoogleProvider } from "../providers/google";
import { createSearxngProvider } from "../providers/searxng";
import { createTavilyProvider } from "../providers/tavily";

export interface ProviderChain {
  primary: SearchProvider;
  /** Tried in order when the primary errors, times out, or returns nothing. */
  fallbacks: SearchProvider[];
}

export interface FallbackResult {
  results: SearchResult[];
  /** `name` of the provider that actually served the results ("none" if all failed). */
  provider: string;
}

const FACTORIES: Record<ProviderId, (cfg: ProviderConfig) => SearchProvider> = {
  exa: createExaProvider,
  searxng: createSearxngProvider,
  duckduckgo: createDuckduckgoProvider,
  brave: createBraveProvider,
  tavily: createTavilyProvider,
  google: createGoogleProvider,
};

const KEYED: readonly ProviderId[] = ["brave", "tavily", "google"];

/** Whether the provider has the keys/config it needs to run. */
function isAvailable(id: ProviderId, cfg: ProviderConfig): boolean {
  switch (id) {
    case "brave":
      return !!cfg.braveApiKey;
    case "tavily":
      return !!cfg.tavilyApiKey;
    case "google":
      return !!cfg.googleApiKey && !!cfg.googleCx;
    case "searxng":
      return !!cfg.searxngBaseUrl;
    default:
      return true; // exa (anonymous ok), duckduckgo (keyless)
  }
}

/**
 * Build the primary provider plus its fallback chain.
 *
 * - Configured provider available → it is primary; fallbacks = [exa, duckduckgo]
 *   (spec-mandated safety net, minus the primary itself).
 * - Configured provider unusable (e.g. keyed provider without key) → auto-pick:
 *   first available keyed provider (brave/tavily/google), else exa;
 *   duckduckgo stays the last resort.
 */
export function createProvider(cfg: ProviderConfig): ProviderChain {
  const primaryId: ProviderId = isAvailable(cfg.provider, cfg)
    ? cfg.provider
    : (KEYED.find((id) => isAvailable(id, cfg)) ?? "exa");
  const primary = FACTORIES[primaryId](cfg);
  const fallbacks = (["exa", "duckduckgo"] as const)
    .filter((id) => id !== primaryId)
    .map((id) => FACTORIES[id](cfg));
  return { primary, fallbacks };
}

/**
 * Try each provider in order; on error/timeout/empty move to the next.
 * Never throws — returns empty results with provider "none" if all fail.
 */
export async function searchWithFallback(
  chain: ProviderChain,
  args: SearchArgs,
): Promise<FallbackResult> {
  for (const provider of [chain.primary, ...chain.fallbacks]) {
    try {
      const results = await provider.search(args);
      if (results.length > 0) return { results, provider: provider.name };
    } catch {
      // provider failed or timed out — fall through to the next one
    }
  }
  return { results: [], provider: "none" };
}
