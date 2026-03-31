/**
 * Roundtrip tests: parse → serialize → parse → compare.
 *
 * These verify that markdown survives a full roundtrip through our
 * mdast → PM → mdast → markdown pipeline without semantic loss.
 */
import { describe, it, expect } from "vite-plus/test";
import { parseMarkdown, serializeMarkdown } from "../index";

/**
 * Helper: Parse markdown, serialize back, parse again, and compare
 * the PM document structures (by JSON representation).
 */
function expectRoundtrip(md: string) {
  const doc1 = parseMarkdown(md);
  const serialized = serializeMarkdown(doc1);
  const doc2 = parseMarkdown(serialized);
  expect(doc2.toJSON()).toEqual(doc1.toJSON());
}

describe("Roundtrip: block-level", () => {
  it("paragraphs", () => {
    expectRoundtrip("Hello world.\n\nSecond paragraph.\n");
  });

  it("headings (all levels)", () => {
    expectRoundtrip("# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n");
  });

  it("blockquote", () => {
    expectRoundtrip("> A quote.\n");
  });

  it("nested blockquote", () => {
    expectRoundtrip("> Outer\n>\n> > Inner\n");
  });

  it("fenced code block", () => {
    expectRoundtrip("```js\nconst x = 1;\n```\n");
  });

  it("fenced code block without language", () => {
    expectRoundtrip("```\nplain code\n```\n");
  });

  it("horizontal rule", () => {
    expectRoundtrip("---\n");
  });

  it("bullet list", () => {
    expectRoundtrip("- one\n- two\n- three\n");
  });

  it("ordered list", () => {
    expectRoundtrip("1. one\n2. two\n3. three\n");
  });

  it("ordered list with custom start", () => {
    expectRoundtrip("3. three\n4. four\n");
  });

  it("nested lists", () => {
    expectRoundtrip("- a\n  - b\n  - c\n- d\n");
  });
});

describe("Roundtrip: inline marks", () => {
  it("emphasis", () => {
    expectRoundtrip("This is *italic* text.\n");
  });

  it("strong", () => {
    expectRoundtrip("This is **bold** text.\n");
  });

  it("inline code", () => {
    expectRoundtrip("This is `code` text.\n");
  });

  it("link", () => {
    expectRoundtrip("[click here](https://example.com)\n");
  });

  it("link with title", () => {
    expectRoundtrip('[click here](https://example.com "A title")\n');
  });

  it("image", () => {
    expectRoundtrip("![alt text](https://example.com/img.png)\n");
  });

  it("image with title", () => {
    expectRoundtrip('![alt text](https://example.com/img.png "A title")\n');
  });

  it("hard break (backslash)", () => {
    expectRoundtrip("line one\\\nline two\n");
  });
});

describe("Roundtrip: mixed content", () => {
  it("paragraph with multiple marks", () => {
    expectRoundtrip("This is **bold** and *italic* and `code`.\n");
  });

  it("heading with marks", () => {
    expectRoundtrip("# Hello **world**\n");
  });

  it("blockquote with marks", () => {
    expectRoundtrip("> A **bold** quote with *emphasis*.\n");
  });

  it("list with marks", () => {
    expectRoundtrip("- **bold** item\n- *italic* item\n- `code` item\n");
  });

  it("complex document", () => {
    const md = `# Title

A paragraph with **bold**, *italic*, and \`code\`.

> A blockquote.

---

- Item 1
- Item 2

1. First
2. Second

\`\`\`js
const x = 1;
\`\`\`
`;
    expectRoundtrip(md);
  });
});

describe("Serialization output", () => {
  it("uses - for bullet lists", () => {
    const doc = parseMarkdown("- one\n- two\n");
    const output = serializeMarkdown(doc);
    expect(output).toContain("- one");
    expect(output).toContain("- two");
  });

  it("uses * for emphasis", () => {
    const doc = parseMarkdown("*italic*\n");
    const output = serializeMarkdown(doc);
    expect(output).toContain("*italic*");
  });

  it("uses ** for strong", () => {
    const doc = parseMarkdown("**bold**\n");
    const output = serializeMarkdown(doc);
    expect(output).toContain("**bold**");
  });

  it("uses ``` for code blocks", () => {
    const doc = parseMarkdown("```\ncode\n```\n");
    const output = serializeMarkdown(doc);
    expect(output).toContain("```");
  });

  it("uses # for headings", () => {
    const doc = parseMarkdown("## Hello\n");
    const output = serializeMarkdown(doc);
    expect(output).toContain("## Hello");
  });

  it("uses --- for horizontal rules", () => {
    const doc = parseMarkdown("---\n");
    const output = serializeMarkdown(doc);
    expect(output).toContain("---");
  });
});
