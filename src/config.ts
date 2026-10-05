import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig, ProviderId, SearchType } from "./types";

export const VALID_PROVIDERS: readonly ProviderId[] = [
  "exa",
  "searxng",
  "duckduckgo",
  "brave",
  "tavily",
  "google",
] as const;

/** Documented defaults, used by loadConfig and by the tool layer for args. */
export const CONFIG_DEFAULTS: Readonly<
  Pick<
    ProviderConfig,
    | "provider"
    | "numResults"
    | "type"
    | "contextMaxCharacters"
    | "cacheTtlSeconds"
    | "requestTimeoutMs"
  >
> = {
  provider: "exa",
  numResults: 8,
  type: "auto",
  contextMaxCharacters: 10_000,
  cacheTtlSeconds: 300,
  requestTimeoutMs: 20_000,
};

/** Fields settable via environment variables, in precedence order. */
const ENV_VARS: Record<string, string> = {
  provider: "PI_WEBSEARCH_PROVIDER",
  exaApiKey: "EXA_API_KEY",
  searxngBaseUrl: "SEARXNG_BASE_URL",
  braveApiKey: "BRAVE_API_KEY",
  tavilyApiKey: "TAVILY_API_KEY",
  googleApiKey: "GOOGLE_API_KEY",
  googleCx: "GOOGLE_CX",
};

const SEARCH_TYPES: readonly SearchType[] = ["auto", "fast", "deep"];

type RawConfig = Record<string, unknown>;

function readConfigFile(path: string): RawConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {}; // missing file → skip (checked with parse errors below)
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RawConfig;
    }
    return {};
  } catch (err) {
    throw new Error(
      `pi-websearch: invalid JSON in config file ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function pickString(sources: readonly RawConfig[], key: string): string | undefined {
  for (const src of sources) {
    const v = src[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}

function pickNumber(sources: readonly RawConfig[], key: string): number | undefined {
  for (const src of sources) {
    const v = src[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function resolveProvider(raw: string): ProviderId {
  if (!(VALID_PROVIDERS as readonly string[]).includes(raw)) {
    throw new Error(
      `pi-websearch: unknown PI_WEBSEARCH_PROVIDER "${raw}". Valid providers: ${VALID_PROVIDERS.join(", ")}`,
    );
  }
  return raw as ProviderId;
}

/**
 * Load the extension config with precedence:
 * env vars > <cwd>/.pi/pi-websearch.json > ~/.pi/agent/pi-websearch.json
 * > built-in defaults. Throws on unknown provider names and on
 * malformed JSON in a config file.
 */
export function loadConfig(cwd: string): ProviderConfig {
  // Precedence: earlier sources win per-field (env > project > global).
  const env: RawConfig = {};
  for (const [key, varName] of Object.entries(ENV_VARS)) {
    const v = process.env[varName];
    if (typeof v === "string" && v.trim() !== "") env[key] = v;
  }
  const sources: RawConfig[] = [
    env,
    readConfigFile(join(cwd, ".pi", "pi-websearch.json")),
    readConfigFile(join(homedir(), ".pi", "agent", "pi-websearch.json")),
  ];

  const providerRaw = pickString(sources, "provider") ?? CONFIG_DEFAULTS.provider;
  const typeRaw = pickString(sources, "type") ?? CONFIG_DEFAULTS.type;

  return {
    provider: resolveProvider(providerRaw),
    numResults:
      pickNumber(sources, "numResults") ?? CONFIG_DEFAULTS.numResults,
    type: (SEARCH_TYPES as readonly string[]).includes(typeRaw)
      ? (typeRaw as SearchType)
      : CONFIG_DEFAULTS.type,
    contextMaxCharacters:
      pickNumber(sources, "contextMaxCharacters") ??
      CONFIG_DEFAULTS.contextMaxCharacters,
    cacheTtlSeconds:
      pickNumber(sources, "cacheTtlSeconds") ?? CONFIG_DEFAULTS.cacheTtlSeconds,
    requestTimeoutMs:
      pickNumber(sources, "requestTimeoutMs") ??
      CONFIG_DEFAULTS.requestTimeoutMs,
    exaApiKey: pickString(sources, "exaApiKey"),
    searxngBaseUrl: pickString(sources, "searxngBaseUrl"),
    braveApiKey: pickString(sources, "braveApiKey"),
    tavilyApiKey: pickString(sources, "tavilyApiKey"),
    googleApiKey: pickString(sources, "googleApiKey"),
    googleCx: pickString(sources, "googleCx"),
  };
}
