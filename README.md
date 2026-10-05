# pi-websearch

Web search + web fetch extension for the [pi coding agent](https://pi.dev) —
and a **drop-in replacement** for the common pi websearch extensions:

| Replaced extension | Tool name(s) it registered | Covered |
|---|---|---|
| `@mammothb/pi-websearch` | `WebSearch` | ✅ |
| `@alfonzjanfrithz/pi-websearch` | `websearch`, `webfetch` | ✅ |
| `pi-web-search` | `web_search` | ✅ |
| `xz-pi-websearch` | `web_search`, `fetch_content` | ✅ |

Replace any of them with this package and every prompt, skill, and
configuration that references `WebSearch`, `websearch`, `web_search`,
`webfetch`, or `fetch_content` keeps working unchanged — the same tool names
with compatible parameter shapes are registered on every session start.

## Features

- **Multi-provider with auto-fallback** — one search backend being down or
  rate-limiting never kills the tool: the request walks the fallback chain
  (primary → Exa → DuckDuckGo) and the served provider is surfaced in the
  result details.
- **Result caching** — identical queries within the TTL (default 300 s) are
  answered from an in-memory cache keyed by provider + query + params. No
  re-hitting the network.
- **Date filtering** — `dateRange` (e.g. `"past_week"`) passed through to
  providers that support it.
- **LLM-optimized context** — results come back as compact
  `Title / URL / snippet` blocks, capped at `contextMaxCharacters`, with a
  truncation marker so the model knows when context was cut.
- **Zero runtime dependencies** — plain `fetch`, `AbortSignal`, and the pi
  types. `devDependencies` only.

## Install

Option A — add to your pi `settings.json`:

```json
{
  "packages": ["npm:@tobias-weiss-ai-xr/pi-websearch"]
}
```

Option B — install via the pi CLI:

```sh
pi install npm:@tobias-weiss-ai-xr/pi-websearch
```

The package manifest (`"pi": { "extensions": ["./src/index.ts"] }`) wires the
extension automatically; nothing else to configure.

## Tools

| Tool names | Purpose | Parameters |
|---|---|---|
| `WebSearch`, `websearch`, `web_search` | Web search (same logical tool, several names for compatibility) | `query` (required), `numResults` (default 8), `type` (`auto`/`fast`/`deep`), `dateRange` (e.g. `past_week`), `contextMaxCharacters` (default 10000) |
| `webfetch`, `fetch_content` | Fetch a URL → markdown | `url` (required, http/https), `maxCharacters` (default 20000) |

## Configuration

Precedence: **env vars > `<project>/.pi/pi-websearch.json` >
`~/.pi/agent/pi-websearch.json` > built-in defaults** (per field).

Config file example (`~/.pi/agent/pi-websearch.json` or
`<project>/.pi/pi-websearch.json`):

```json
{
  "provider": "searxng",
  "searxngBaseUrl": "http://localhost:8080",
  "numResults": 8,
  "type": "auto",
  "contextMaxCharacters": 10000,
  "cacheTtlSeconds": 300,
  "requestTimeoutMs": 20000
}
```

### Reference

| Setting | Env var | Default | Purpose |
|---|---|---|---|
| `provider` | `PI_WEBSEARCH_PROVIDER` | `exa` | Primary provider: `exa`, `searxng`, `duckduckgo`, `brave`, `tavily`, `google` |
| `exaApiKey` | `EXA_API_KEY` | – | Exa API key (works anonymously without one) |
| `searxngBaseUrl` | `SEARXNG_BASE_URL` | – | Self-hosted SearXNG instance URL (required for `searxng`) |
| `braveApiKey` | `BRAVE_API_KEY` | – | Brave Search API key |
| `tavilyApiKey` | `TAVILY_API_KEY` | – | Tavily API key |
| `googleApiKey` | `GOOGLE_API_KEY` | – | Google Programmable Search API key (needs `googleCx` too) |
| `googleCx` | `GOOGLE_CX` | – | Google Programmable Search engine ID |
| `numResults` | – | `8` | Default result count |
| `type` | – | `auto` | Search depth: `auto`, `fast`, `deep` |
| `contextMaxCharacters` | – | `10000` | Max characters of returned search context |
| `cacheTtlSeconds` | – | `300` | Result cache TTL |
| `requestTimeoutMs` | – | `20000` | Per-request network timeout |

## Providers

| Provider | Keyless | Privacy | Notes |
|---|---|---|---|
| **Exa** *(default)* | ✅ (rate-limited anonymously) | Queries sent to exa.ai | Neural + keyword search, clean snippets, via MCP JSON-RPC |
| **SearXNG** | ✅ | **Best** — self-hosted, nothing leaves your server | Requires `SEARXNG_BASE_URL` |
| **DuckDuckGo** | ✅ | Queries sent to duckduckgo.com | Keyless HTML scraping of `/lite`; last-resort fallback |
| **Brave** | ❌ needs `BRAVE_API_KEY` | Queries sent to api.search.brave.com | Independent index |
| **Tavily** | ❌ needs `TAVILY_API_KEY` | Queries sent to api.tavily.com | LLM-oriented search API |
| **Google CSE** | ❌ needs `GOOGLE_API_KEY` + `GOOGLE_CX` | Queries sent to googleapis.com | Programmable Search Engine |

**Fallback behavior:** the configured provider is primary; if it errors,
times out, or returns nothing, the chain walks through the remaining
keyless providers (Exa → DuckDuckGo). Keyed providers without their key are
skipped automatically. If everything fails you get an empty result set with
`provider: "none"` — the tool never throws at the LLM.

For maximum privacy set `provider: "searxng"` with your own SearXNG URL; the
fallbacks stay keyless (Exa/DDG) in case your instance is down.

## Performance

- **Caching:** identical queries within `cacheTtlSeconds` (default 300 s) are
  served from an in-memory TTL cache — zero network round-trips. Cache keys
  include provider, query, and all params, so different `numResults` /
  `dateRange` don't collide.
- **Timeouts:** every network call is bounded by `requestTimeoutMs`
  (default 20 s) via `AbortSignal` — a hung backend costs at most one
  timeout, then the next provider in the chain takes over.
- **Context capping:** results are truncated to `contextMaxCharacters`, so a
  single search can't flood the model's context window no matter how many
  results a provider returns.

## Development

```sh
bun install          # devDeps only (zero runtime deps)
bun run typecheck    # tsc --noEmit (strict)
bun test             # hermetic unit tests (mocked fetch)
```

Architecture: `src/index.ts` (extension entrypoint) · `src/config.ts` (config
loader) · `src/providers/*.ts` (one file per backend) · `src/lib/` (cache,
markdown, provider registry). See `AGENTS.md` for conventions.

## License

MIT
