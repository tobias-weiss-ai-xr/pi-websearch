import { describe, expect, test } from "bun:test";
import { TRUNCATION_MARKER, htmlToMarkdown, stripScriptStyle } from "../src/lib/markdown";

describe("htmlToMarkdown", () => {
  test("strips script and style content before conversion", () => {
    const html =
      "<div><script>alert('xss')</script><style>.x { color: red }</style><h1>Title</h1></div>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).not.toContain("alert");
    expect(md).not.toContain("color");
  });

  test("converts headings, links, and emphasis", () => {
    const md = htmlToMarkdown(
      '<h1>Hi</h1><p>see <a href="https://x.y">doc</a> and <em>this</em></p>',
    );
    expect(md).toContain("# Hi");
    expect(md).toContain("[doc](https://x.y)");
    expect(md).toContain("_this_"); // turndown default emDelimiter
  });

  test("limits output to maxChars with an ellipsis marker", () => {
    const html = `<p>${"word ".repeat(500)}</p>`;
    const maxChars = 100;
    const md = htmlToMarkdown(html, maxChars);
    expect(md.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(md.length).toBeLessThanOrEqual(maxChars + TRUNCATION_MARKER.length);
    expect(md).toContain("word");
  });

  test("no marker when output fits", () => {
    const md = htmlToMarkdown("<p>short</p>", 10_000);
    expect(md).not.toContain("truncated");
    expect(md).toBe("short");
  });

  test("empty input yields empty output", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});

describe("stripScriptStyle", () => {
  test("removes script/style elements including content", () => {
    const cleaned = stripScriptStyle(
      "<p>a</p><script type=\"text/javascript\">var x = 1;</script><p>b</p><style>p { margin: 0 }</style>",
    );
    expect(cleaned).toBe("<p>a</p><p>b</p>");
  });

  test("is case-insensitive and multiline", () => {
    const cleaned = stripScriptStyle(
      "<SCRIPT>\nline1\nline2\n</SCRIPT><p>ok</p>",
    );
    expect(cleaned).toBe("<p>ok</p>");
  });
});
