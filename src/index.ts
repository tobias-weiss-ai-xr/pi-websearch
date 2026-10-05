import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * pi-websearch — drop-in replacement web search + web fetch extension.
 *
 * Baseline stub: registers the tool surface so the package loads and
 * typechecks. Real implementations land in src/websearch.ts and
 * src/webfetch.ts (see AGENTS.md).
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const registered = new Set<string>();

    for (const name of ["WebSearch", "websearch", "web_search"]) {
      if (registered.has(name)) continue;
      registered.add(name);
      pi.registerTool({
        name,
        label: "Web Search",
        description: `Web search (drop-in compatible tool name: ${name}). Query the web and return current, cited results.`,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            numResults: {
              type: "number",
              description: "Number of results (default 8)",
            },
          },
          required: ["query"],
        } as const,
        execute: async (_id, params) => {
          // Stub: replaced by the real provider-based search.
          const q = (params as { query?: string }).query ?? "";
          return {
            content: [
              {
                type: "text",
                text: `[stub] WebSearch "${q}" — implemented in src/websearch.ts`,
              },
            ],
            details: { query: q },
          };
        },
      });
    }
    if (!registered.has("webfetch")) {
      pi.registerTool({
        name: "webfetch",
        label: "Fetch URL",
        description: "Fetch a URL and return its content as markdown.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to fetch" },
          },
          required: ["url"],
        } as const,
        execute: async (_id, params) => {
          const url = (params as { url?: string }).url ?? "";
          return {
            content: [
              {
                type: "text",
                text: `[stub] webfetch ${url} — implemented in src/webfetch.ts`,
              },
            ],
            details: { url },
          };
        },
      });
    }
    ctx.ui.notify("pi-websearch: loaded (baseline stub)", "info");
  });
}
