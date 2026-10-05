import type { ProviderConfig, SearchArgs, SearchProvider, SearchResult } from "../types";

const LITE_URL = "https://lite.duckduckgo.com/lite/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Keyless DuckDuckGo search via the lite HTML endpoint. Parses the
 * `result-link` anchors and `result-snippet` cells positionally; an empty
 * page (bot wall, no hits) is tolerated as zero results.
 */
export function createDuckduckgoProvider(
  cfg: Pick<ProviderConfig, "requestTimeoutMs">,
): SearchProvider {
  return {
    name: "duckduckgo",
    usageNotes:
      "Keyless last-resort HTML scraping of duckduckgo.com/lite. No API key, but fragile and rate-limited.",
    async search(args: SearchArgs): Promise<SearchResult[]> {
      const res = await fetch(`${LITE_URL}?q=${encodeURIComponent(args.query)}`, {
        headers: { "user-agent": UA, accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.any([
          AbortSignal.timeout(cfg.requestTimeoutMs ?? 20_000),
          ...(args.signal ? [args.signal] : []),
        ]),
      });
      if (!res.ok) throw new Error(`duckduckgo: HTTP ${res.status}`);
      const results = parseLiteHtml(await res.text());
      return results.slice(0, args.numResults ?? 8);
    },
  };
}

/** Parse lite HTML: zip result-link anchors with result-snippet cells in order. */
function parseLiteHtml(html: string): SearchResult[] {
  const links = [
    ...html.matchAll(/<a\b[^>]*class=["']?result-link["']?[^>]*>([\s\S]*?)<\/a>/gi),
  ];
  const snippets = [
    ...html.matchAll(/<(?:td|div)[^>]*class=["']?result-snippet["']?[^>]*>([\s\S]*?)<\/(?:td|div)>/gi),
  ];
  const results: SearchResult[] = [];
  for (let i = 0; i < links.length; i++) {
    const href = /\shref=["']([^"']+)["']/i.exec(links[i][0])?.[1] ?? "";
    const url = unwrapHref(href);
    if (!url) continue;
    // Decode first, then strip: entity-encoded tags (&lt;b&gt;) must not
    // survive as literal markup.
    const title = clean(links[i][1] ?? "");
    const snippet = snippets[i] ? clean(snippets[i][1] ?? "") : "";
    results.push({ title: title || url, url, snippet });
  }
  return results;
}

/** Resolve DDG redirect links (…/l/?uddg=<encoded>) to the target URL. */
function unwrapHref(href: string): string {
  if (!href) return "";
  try {
    const url = new URL(href, "https://duckduckgo.com");
    return url.searchParams.get("uddg") ?? url.toString();
  } catch {
    return "";
  }
}

/** Decode entities, drop tags, collapse whitespace. */
function clean(html: string): string {
  return stripTags(decodeEntities(html)).replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/** Decode named/numeric HTML entities; &amp; last to avoid double-decoding. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(hex, 16))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(dec, 10))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function codePoint(digits: string, radix: number): string {
  const n = parseInt(digits, radix);
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff
    ? String.fromCodePoint(n)
    : "";
}
