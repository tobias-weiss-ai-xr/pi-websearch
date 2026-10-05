import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { TRUNCATION_MARKER, htmlToMarkdown } from "./lib/markdown";

const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_CHARS = 20_000;

export interface WebfetchParams {
  url: string;
  maxCharacters?: number;
}

export interface WebfetchDetails {
  url: string;
  status: number;
  fetchedBytes: number;
  markdownChars: number;
  truncated: boolean;
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((c) => c.type === "text")?.text ?? "";
}

/** Plain-text (non-HTML) response, truncated like htmlToMarkdown does. */
function plainText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars).trimEnd() + TRUNCATION_MARKER, truncated: true };
}

/**
 * Build the fetch tool ToolDefinition. Registered twice under the drop-in
 * names "webfetch" and "fetch_content" (pi keys tools by definition.name).
 */
export function createWebfetchTool(name = "webfetch"): ToolDefinition {
  return {
    name,
    label: "Fetch URL",
    description: `Fetch a URL and return its content as markdown (${name}).`,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP(S) URL to fetch" },
        maxCharacters: {
          type: "number",
          description: `Max characters of returned markdown (default ${DEFAULT_MAX_CHARS})`,
        },
      },
      required: ["url"],
    } as const,

    execute: async (_id, params) => {
      const p = params as WebfetchParams;
      const url = (p.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new Error(`${name}: 'url' must be an http(s) URL`);
      }
      const maxChars = p.maxCharacters ?? DEFAULT_MAX_CHARS;

      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "text/html,text/markdown,text/plain,*/*" },
      });
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`);

      const raw = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      const isHtml = /html/i.test(contentType) || /^\s*</.test(raw);
      const { text, truncated } = isHtml
        ? // ponytail: htmlToMarkdown reports no truncation flag — detect via marker suffix
          (() => {
            const md = htmlToMarkdown(raw, maxChars);
            return { text: md, truncated: md.endsWith(TRUNCATION_MARKER.trim()) };
          })()
        : plainText(raw, maxChars);

      const details: WebfetchDetails = {
        url,
        status: res.status,
        fetchedBytes: raw.length,
        markdownChars: text.length,
        truncated,
      };
      return {
        content: [{ type: "text", text: text || "(empty page)" }],
        details,
      };
    },

    renderCall(args, theme, context) {
      const url = typeof (args as WebfetchParams | undefined)?.url === "string"
        ? (args as WebfetchParams).url
        : "";
      const component = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
      component.setText(
        theme.fg("toolTitle", theme.bold(name)) + " " + theme.fg("accent", url),
      );
      return component;
    },

    renderResult(result, options, theme, context) {
      const d = result.details as WebfetchDetails | undefined;
      const component = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
      let text =
        theme.fg("toolTitle", theme.bold(name)) +
        " " +
        theme.fg("accent", d?.url ?? "") +
        theme.fg("muted", `  ${d?.fetchedBytes ?? 0} bytes → ${d?.markdownChars ?? 0} chars`);
      if (options.isPartial) {
        text += "\n" + theme.fg("warning", "Fetching…");
        component.setText(text);
        return component;
      }
      const output = firstText(result).trim();
      if (output) {
        const lines = output.split("\n");
        const maxLines = options.expanded ? lines.length : 12;
        text +=
          "\n" +
          lines
            .slice(0, maxLines)
            .map((line) => theme.fg("toolOutput", line))
            .join("\n");
        const remaining = lines.length - maxLines;
        if (remaining > 0) {
          text += theme.fg("muted", `\n… (${remaining} more lines — expand to view all)`);
        }
        if (d?.truncated) {
          text += theme.fg("warning", "\n[Truncated at maxCharacters]");
        }
      }
      component.setText(text);
      return component;
    },
  };
}
