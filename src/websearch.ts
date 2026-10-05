import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { TTLCache } from "./lib/cache";
import { TRUNCATION_MARKER } from "./lib/markdown";
import { createProvider, searchWithFallback, type FallbackResult } from "./lib/providers";
import type { ProviderConfig, SearchArgs, SearchResult, SearchType } from "./types";

/** Collapsed result preview shows this many lines before the expand hint. */
const PREVIEW_LINES = 12;

export interface WebsearchParams {
  query: string;
  numResults?: number;
  type?: SearchType;
  dateRange?: string;
  contextMaxCharacters?: number;
}

export interface WebsearchDetails {
  query: string;
  /** Provider that actually served the results ("none" if all failed). */
  provider: string;
  resultCount: number;
  cached: boolean;
  truncated: boolean;
}

/**
 * LLM-optimized result text: one `Title\nURL\n<highlights|snippet>` block per
 * result, blank-line separated, capped at maxChars total.
 */
export function formatResults(
  results: SearchResult[],
  maxChars: number,
): { text: string; truncated: boolean } {
  let text = "";
  let truncated = false;
  for (const r of results) {
    const body = (
      r.highlights && r.highlights.length > 0 ? r.highlights.join(" … ") : r.snippet
    )
      .replace(/\s+/g, " ")
      .trim();
    const block = `${r.title}\n${r.url}\n${body}`;
    const candidate = text ? `${text}\n\n${block}` : block;
    if (candidate.length > maxChars) {
      truncated = true;
      break;
    }
    text = candidate;
  }
  return { text, truncated };
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((c) => c.type === "text")?.text ?? "";
}

/**
 * Build the search tool ToolDefinition. Registered once per drop-in name
 ("WebSearch", "websearch", "web_search") — pi keys tools by definition.name,
 so each name gets its own definition of the same logical tool.
 */
export function createWebsearchTool(
  config: ProviderConfig,
  name = "WebSearch",
): ToolDefinition {
  // Provider chain and result cache: plain closures, no sockets/timers here.
  const chain = createProvider(config);
  const cache = new TTLCache<FallbackResult>(config.cacheTtlSeconds);

  return {
    name,
    label: "Web Search",
    description: `Web search (${name}). Query the web and return current, cited results as Title/URL/snippet blocks.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: {
          type: "number",
          description: `Number of results (default ${config.numResults})`,
        },
        type: {
          type: "string",
          enum: ["auto", "fast", "deep"],
          description: "Search depth (default auto)",
        },
        dateRange: {
          type: "string",
          description: 'Time filter, e.g. "past_week" (provider-interpreted)',
        },
        contextMaxCharacters: {
          type: "number",
          description: `Max characters of returned context (default ${config.contextMaxCharacters})`,
        },
      },
      required: ["query"],
    } as const,

    execute: async (_id, params) => {
      const p = params as WebsearchParams;
      const query = (p.query ?? "").trim();
      if (!query) throw new Error(`${name}: 'query' is required`);

      const args: SearchArgs = {
        query,
        numResults: p.numResults ?? config.numResults,
        type: p.type ?? config.type,
        ...(p.dateRange ? { dateRange: p.dateRange } : {}),
        contextMaxCharacters:
          p.contextMaxCharacters ?? config.contextMaxCharacters,
      };

      const key = TTLCache.cacheKey(chain.primary.name, args);
      const hit = cache.get(key);
      const fallback = hit ?? (await searchWithFallback(chain, args));
      if (!hit) cache.set(key, fallback);

      const { text, truncated } =
        fallback.results.length === 0
          ? {
              text: `No results found for "${query}".`,
              truncated: false,
            }
          : formatResults(fallback.results, args.contextMaxCharacters ?? config.contextMaxCharacters);

      const details: WebsearchDetails = {
        query,
        provider: fallback.provider,
        resultCount: fallback.results.length,
        cached: hit !== undefined,
        truncated,
      };
      return {
        content: [{ type: "text", text }],
        details,
      };
    },

    renderCall(args, theme, context) {
      const query = typeof (args as WebsearchParams | undefined)?.query === "string"
        ? (args as WebsearchParams).query
        : "";
      const component = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
      component.setText(
        theme.fg("toolTitle", theme.bold(name)) +
          " " +
          theme.fg("accent", query),
      );
      return component;
    },

    renderResult(result, options, theme, context) {
      const d = result.details as WebsearchDetails | undefined;
      const container = context.lastComponent instanceof Container
        ? context.lastComponent
        : new Container();
      container.clear();

      const header =
        theme.fg("toolTitle", theme.bold(name)) +
        " " +
        theme.fg("accent", d?.query ?? "") +
        theme.fg(
          "muted",
          `  ${d?.resultCount ?? 0} results · ${d?.provider ?? "?"}${d?.cached ? " · cached" : ""}`,
        );

      if (options.isPartial) {
        container.addChild(
          new Text(`${header}\n${theme.fg("warning", "Searching…")}`, 0, 0),
        );
        return container;
      }

      container.addChild(new Text(header, 0, 0));
      container.addChild(new Spacer(1));

      const output = firstText(result).trim();
      if (output) {
        const lines = output.split("\n");
        const maxLines = options.expanded ? lines.length : PREVIEW_LINES;
        let body = lines
          .slice(0, maxLines)
          .map((line) => theme.fg("toolOutput", line))
          .join("\n");
        const remaining = lines.length - maxLines;
        if (remaining > 0) {
          body += theme.fg(
            "muted",
            `\n… (${remaining} more lines — expand to view all)`,
          );
        }
        if (d?.truncated) {
          body += theme.fg("warning", `\n[Truncated at context limit]`);
        }
        container.addChild(new Text(body, 0, 0));
      }
      return container;
    },
  };
}
