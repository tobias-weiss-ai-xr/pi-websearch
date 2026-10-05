import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config";
import { createWebfetchTool } from "./webfetch";
import { createWebsearchTool } from "./websearch";

/**
 * pi-websearch — drop-in replacement web search + web fetch extension.
 *
 * Registers the search tool under every name the replaced extensions use
 * ("WebSearch", "websearch", "web_search") and the fetch tool as "webfetch"
 * and "fetch_content". pi keys tools by definition.name, so each drop-in
 * name gets its own ToolDefinition (built by the same factory with the same
 * config — one logical tool, no duplicates).
 */
export default function (pi: ExtensionAPI) {
  let shutdownDone = false;

  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig(process.cwd());

    const registered = new Set<string>();
    for (const name of ["WebSearch", "websearch", "web_search"]) {
      if (registered.has(name)) continue;
      registered.add(name);
      pi.registerTool(createWebsearchTool(config, name));
    }
    for (const name of ["webfetch", "fetch_content"]) {
      if (registered.has(name)) continue;
      registered.add(name);
      pi.registerTool(createWebfetchTool(name));
    }

    ctx.ui.notify(
      `pi-websearch ready (provider: ${config.provider}, cache TTL: ${config.cacheTtlSeconds}s)`,
      "info",
    );
  });

  // Nothing persistent to tear down (providers are stateless closures,
  // SearXNG is an external HTTP service) — the handler exists for the
  // lifecycle contract and must be idempotent.
  pi.on("session_shutdown", async () => {
    if (shutdownDone) return;
    shutdownDone = true;
  });
}
