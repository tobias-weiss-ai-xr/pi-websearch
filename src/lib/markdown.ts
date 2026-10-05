import { createRequire } from "node:module";

// turndown is a devDependency without bundled types; require it and cast
// to the small surface we use (keeps the package.json untouched).
interface TurndownService {
  turndown(html: string): string;
}
const require = createRequire(import.meta.url);
const TurndownService = require("turndown") as new (options?: {
  headingStyle?: "setext" | "atx";
  codeBlockStyle?: "indented" | "fenced";
}) => TurndownService;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

/** Matches complete <script>/<style> elements including their content. */
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Appended when conversion output exceeds maxChars. */
export const TRUNCATION_MARKER = "\n\n[… truncated]";

/** Remove <script>/<style> elements — turndown would leak them as text. */
export function stripScriptStyle(html: string): string {
  return html.replace(SCRIPT_OR_STYLE, "");
}

/** Convert HTML to markdown, limited to maxChars with an ellipsis marker. */
export function htmlToMarkdown(html: string, maxChars = 20_000): string {
  const markdown = turndown.turndown(stripScriptStyle(html)).trim();
  if (markdown.length <= maxChars) return markdown;
  return markdown.slice(0, maxChars).trimEnd() + TRUNCATION_MARKER;
}
