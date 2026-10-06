/**
 * Shared types for the pi-websearch extension.
 *
 * The parameter surface is a superset of the drop-in replacement targets
 * (@mammothb/pi-websearch, @alfonzjanfrithz/pi-websearch, pi-web-search,
 * xz-pi-websearch) so their tool names can be registered without
 * re-shaping arguments.
 */

/** Minimal result shape every provider normalizes to. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Match fragments the backend flagged as most relevant, if provided. */
  highlights?: string[];
  /** ISO date (or backend-native date string) if known. */
  publishedDate?: string;
}

export type SearchType = "auto" | "fast" | "deep";

/**
 * Arguments for a single web search. Only `query` is required; the other
 * fields carry documented defaults and are normalized by the tool layer
 * (see CONFIG_DEFAULTS in src/config.ts) before reaching a provider.
 */
export interface SearchArgs {
  query: string;
  /** Default 8. */
  numResults?: number;
  /** Default "auto". */
  type?: SearchType;
  /** Free-form time filter, e.g. "past_week" — interpreted per provider. */
  dateRange?: string;
  /** Max characters of per-result context. Default 10000. */
  contextMaxCharacters?: number;
  /** Abort signal for the underlying network calls. Excluded from cache keys. */
  signal?: AbortSignal;
}

/** A search backend. One file per provider under src/providers/. */
export interface SearchProvider {
  name: string;
  search(args: SearchArgs): Promise<SearchResult[]>;
  /** When this provider should (not) be preferred, surfaced to the LLM. */
  usageNotes?: string;
}

export type ProviderId =
  | "exa"
  | "searxng"
  | "duckduckgo"
  | "brave"
  | "tavily"
  | "google"
  | "cloudflare";

/** Fully-resolved extension configuration; defaults filled in by loadConfig. */
export interface ProviderConfig {
  provider: ProviderId;
  numResults: number;
  type: SearchType;
  contextMaxCharacters: number;
  cacheTtlSeconds: number;
  requestTimeoutMs: number;
  exaApiKey?: string;
  searxngBaseUrl?: string;
  braveApiKey?: string;
  tavilyApiKey?: string;
  googleApiKey?: string;
  googleCx?: string;
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;
  /** AI Gateway to route through; defaults to "default". */
  cloudflareGatewayId?: string;
}
