# AGENTS.md — pi-websearch (pi coding agent extension)

A web search + web fetch extension for the [pi coding agent](https://pi.dev).

**Drop-in replacement** for the common pi websearch extensions:
`@mammothb/pi-websearch` (tool `WebSearch`), `@alfonzjanfrithz/pi-websearch`
(tools `websearch`/`webfetch`), `pi-web-search` (tool `web_search`), and
`xz-pi-websearch` (tools `web_search`/`fetch_content`). Register the same
tool names and compatible parameter shapes so existing prompts, skills, and
configurations keep working unchanged.

## Commands

```bash
bun install              # install devDeps (types, turndown)
bun run typecheck        # tsc --noEmit (strict)
bun test                 # bun test runner (tests/ dir)
```

## Architecture

- `src/index.ts` — the pi extension entrypoint (default export factory).
  Registers tools via `pi.registerTool(...)` inside `pi.on("session_start")`.
  Also registers a `session_shutdown` handler for clean SearXNG lifecycle.
- `src/types.ts` — shared TypeScript types (SearchResult, SearchProvider, etc.).
- `src/config.ts` — config loader. Reads `~/.pi/agent/pi-websearch.json`,
  then `<project>/.pi/pi-websearch.json`, then env vars (`PI_WEBSEARCH_PROVIDER`,
  `EXA_API_KEY`, `SEARXNG_BASE_URL`, `BRAVE_API_KEY`, `TAVILY_API_KEY`,
  `GOOGLE_API_KEY`, `GOOGLE_CX`, …). Explicit env/config > project file > global file > defaults.
- `src/providers/*.ts` — one file per search backend. All implement a tiny
  `SearchProvider` interface (`search(args) => Promise<SearchResult[]>`).
  No heavy deps: use global `fetch` (Node 18+/bun have it).
- `src/websearch.ts` — builds the `WebSearch` / `websearch` / `web_search`
  tool (same logical tool, several names for drop-in compatibility).
- `src/webfetch.ts` — builds the `webfetch` / `fetch_content` tool
  (HTML→markdown via turndown).
- `src/lib/` — helpers (cache, markdown, provider registry with auto-fallback).

## Tool surface (drop-in compatibility)

| Tool names | Purpose | Key params |
|---|---|---|
| `WebSearch`, `websearch`, `web_search` | web search | `query` (req), `numResults` (default 8), `type` (auto/fast/deep), `dateRange` (e.g. `past_week`), `contextMaxCharacters` (default 10000) |
| `webfetch`, `fetch_content` | fetch URL → markdown | `url` (req), `maxCharacters` (default 20000) |

## Provider strategy

Default provider: **Exa MCP** (`https://mcp.exa.ai/mcp`, JSON-RPC over HTTP,
works anonymously). Alternative: **SearXNG** (self-hosted, private).
Optional keyed providers: Brave, Tavily, Google CSE, Cloudflare.

Auto-fallback chain on provider failure (so the tool never dies on one
backend being down). Result cache with TTL (default 300 s) keyed by
provider+query+params — do NOT re-hit the network for identical queries.

## Hard rules

1. **Zero runtime deps.** Only `devDependencies`; runtime uses global `fetch`,
   `Text`-encoding, and the pi/tui types. Do not add runtime npm packages.
2. **Every network call is time-bounded** — pass an `AbortSignal` with a
   timeout (default 20 s) to `fetch`.
3. **`bun run typecheck` and `bun test` must pass.** Strict TS, no `any`
   leaks (use `unknown` + narrowing).
4. **Tool rendering** uses `@earendil-works/pi-tui` components (`Container`,
   `Text`, `Spacer`) + theme colors — collapse long text with expand/collapse
   like mammothb does. Keep result rendering LLM-optimized (title, url, snippet).
5. **Safe markdown**: use `turndown` (devDep) for HTML→markdown; strip
   scripts/styles first.
6. Do not create sockets/processes/timers in the factory itself — start
   providers lazily in `session_start`; close in `session_shutdown`.

## Testing

`bun test` discovers `tests/*.test.ts`. Keep provider tests hermetic (mock
`fetch`); do not hit live endpoints in unit tests. Add a test for each new
provider's URL/body construction + response parsing.
