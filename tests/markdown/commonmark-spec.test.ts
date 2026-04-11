/**
 * CommonMark spec compliance tests.
 *
 * Loads the official spec.json and runs each relevant example through
 * parseMarkdown, verifying:
 * 1. Parsing does not throw
 * 2. The result is a valid PM document
 * 3. Structural spot-checks for key sections
 */
import { describe, it, expect } from "vite-plus/test";
import { parseMarkdown } from "../../src/markdown";
import specData from "./fixtures/commonmark-spec.json";

interface SpecExample {
  markdown: string;
  html: string;
  example: number;
  start_line: number;
  end_line: number;
  section: string;
}

const spec = specData as SpecExample[];

// Sections our schema should handle (we skip HTML blocks, raw HTML, autolinks)
const supportedSections = [
  "Thematic breaks",
  "ATX headings",
  "Setext headings",
  "Indented code blocks",
  "Fenced code blocks",
  "Paragraphs",
  "Blank lines",
  "Block quotes",
  "List items",
  "Lists",
  "Backslash escapes",
  "Entity and numeric character references",
  "Code spans",
  "Emphasis and strong emphasis",
  "Links",
  "Images",
  "Hard line breaks",
  "Soft line breaks",
  "Tabs",
  "Precedence",
  "Link reference definitions",
];

/**
 * Detect examples that use features we intentionally don't support
 * (raw HTML, autolinks). This is more robust than a brittle set of
 * hardcoded example numbers that break when the spec updates.
 *
 * We strip several safe constructs before checking so that angle
 * brackets in code blocks, code spans, escaped characters, and
 * link/image destinations don't trigger false positives.
 */
function usesUnsupportedFeatures(markdown: string): boolean {
  let stripped = markdown;
  // Strip fenced code blocks — HTML inside code is literal
  stripped = stripped.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, "");
  // Strip indented code blocks (4+ spaces or tab)
  stripped = stripped.replace(/^(?: {4}|\t).*$/gm, "");
  // Strip code spans
  stripped = stripped.replace(/`[^`\n]+`/g, "");
  // Strip backslash-escaped angle brackets (e.g. \<br/> in backslash-escape examples)
  stripped = stripped.replace(/\\</g, "");
  // Strip angle-bracket link/image destinations: ](<...>)
  stripped = stripped.replace(/]\(<[^>]*>\)/g, "");
  // Strip angle-bracket link reference destinations: ]: <...>
  stripped = stripped.replace(/]:\s*<[^>]*>/g, "");

  // Raw HTML: opening, closing, or self-closing tags
  if (/<\/?[a-zA-Z][^>]*>/m.test(stripped)) return true;
  // Autolinks: <scheme:...>
  if (/<[a-zA-Z][a-zA-Z0-9+.-]*:[^\s>]+>/m.test(stripped)) return true;
  // Email autolinks: <user@domain>
  if (/<[^\s<>@]+@[^\s<>]+\.[^\s<>]+>/m.test(stripped)) return true;

  return false;
}

const relevantExamples = spec.filter(
  (ex) => supportedSections.includes(ex.section) && !usesUnsupportedFeatures(ex.markdown),
);

describe("CommonMark spec compliance", () => {
  describe("parse without throwing", () => {
    for (const ex of relevantExamples) {
      it(`example ${ex.example} (${ex.section}, line ${ex.start_line})`, () => {
        expect(() => parseMarkdown(ex.markdown)).not.toThrow();
      });
    }
  });

  describe("produces valid document", () => {
    for (const ex of relevantExamples) {
      it(`example ${ex.example} has valid doc`, () => {
        const doc = parseMarkdown(ex.markdown);
        expect(doc.type.name).toBe("doc");
        expect(doc.content.size).toBeGreaterThanOrEqual(0);
      });
    }
  });
});

// ---------- Structural spot-checks for specific sections ----------

describe("CommonMark: ATX headings", () => {
  it("parses all 6 heading levels (example 62)", () => {
    const doc = parseMarkdown("# foo\n## foo\n### foo\n#### foo\n##### foo\n###### foo\n");
    const levels: number[] = [];
    doc.forEach((node) => {
      if (node.type.name === "heading") {
        levels.push(node.attrs.depth as number);
      }
    });
    expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("7 hashes is not a heading (example 63)", () => {
    const doc = parseMarkdown("####### foo\n");
    expect(doc.firstChild?.type.name).toBe("paragraph");
  });

  it("heading with inline emphasis (example 66)", () => {
    const doc = parseMarkdown("# foo *bar* \\*baz\\*\n");
    const heading = doc.firstChild!;
    expect(heading.type.name).toBe("heading");
    expect(heading.attrs.depth).toBe(1);
    // Should contain text with em mark
    let hasEm = false;
    heading.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "emphasis")) hasEm = true;
    });
    expect(hasEm).toBe(true);
  });

  it("empty headings (example 79)", () => {
    const doc = parseMarkdown("## \n#\n### ###\n");
    let headingCount = 0;
    doc.forEach((node) => {
      if (node.type.name === "heading") headingCount++;
    });
    expect(headingCount).toBe(3);
  });
});

describe("CommonMark: Setext headings", () => {
  it("parses setext h1 and h2 (example 80)", () => {
    const doc = parseMarkdown("Foo *bar*\n=========\n\nFoo *bar*\n---------\n");
    const headings: number[] = [];
    doc.forEach((node) => {
      if (node.type.name === "heading") headings.push(node.attrs.depth as number);
    });
    expect(headings).toEqual([1, 2]);
  });
});

describe("CommonMark: Thematic breaks", () => {
  it("three variants all produce horizontal_rule (example 43)", () => {
    const doc = parseMarkdown("***\n---\n___\n");
    let hrCount = 0;
    doc.forEach((node) => {
      if (node.type.name === "thematic_break") hrCount++;
    });
    expect(hrCount).toBe(3);
  });

  it("+++ is not a thematic break (example 44)", () => {
    const doc = parseMarkdown("+++\n");
    expect(doc.firstChild?.type.name).toBe("paragraph");
  });
});

describe("CommonMark: Fenced code blocks", () => {
  it("backtick fence (example 119)", () => {
    const doc = parseMarkdown("```\n<\n >\n```\n");
    expect(doc.firstChild?.type.name).toBe("code");
  });

  it("tilde fence (example 120)", () => {
    const doc = parseMarkdown("~~~\n<\n >\n~~~\n");
    expect(doc.firstChild?.type.name).toBe("code");
  });

  it("language info string (example 142)", () => {
    const doc = parseMarkdown("```ruby\ndef foo(x)\n  return 3\nend\n```\n");
    const cb = doc.firstChild!;
    expect(cb.type.name).toBe("code");
    expect(cb.attrs.lang).toBe("ruby");
  });

  it("preserves code content (example 142)", () => {
    const doc = parseMarkdown("```ruby\ndef foo(x)\n  return 3\nend\n```\n");
    expect(doc.firstChild!.textContent).toBe("def foo(x)\n  return 3\nend");
  });
});

describe("CommonMark: Indented code blocks", () => {
  it("4-space indent creates code block (example 107)", () => {
    const doc = parseMarkdown("    a simple\n      indented code block\n");
    expect(doc.firstChild?.type.name).toBe("code");
  });
});

describe("CommonMark: Block quotes", () => {
  it("basic blockquote with heading and paragraph (example 228)", () => {
    const doc = parseMarkdown("> # Foo\n> bar\n> baz\n");
    const bq = doc.firstChild!;
    expect(bq.type.name).toBe("blockquote");
    expect(bq.firstChild?.type.name).toBe("heading");
    expect(bq.child(1)?.type.name).toBe("paragraph");
  });
});

describe("CommonMark: Lists", () => {
  it("bullet list items", () => {
    const doc = parseMarkdown("- one\n- two\n- three\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("list");
    expect(list.childCount).toBe(3);
    expect(list.firstChild?.type.name).toBe("list_item");
  });

  it("ordered list with start number", () => {
    const doc = parseMarkdown("3. one\n4. two\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("list");
    expect(list.attrs.start).toBe(3);
    expect(list.childCount).toBe(2);
  });

  it("nested lists", () => {
    const doc = parseMarkdown("- a\n  - b\n    - c\n");
    const outerList = doc.firstChild!;
    expect(outerList.type.name).toBe("list");
    // First list_item should contain a nested list
    const firstItem = outerList.firstChild!;
    let hasNestedList = false;
    firstItem.forEach((child) => {
      if (child.type.name === "list") hasNestedList = true;
    });
    expect(hasNestedList).toBe(true);
  });
});

describe("CommonMark: Emphasis and strong", () => {
  it("basic emphasis with asterisks", () => {
    const doc = parseMarkdown("*foo bar*\n");
    const para = doc.firstChild!;
    let hasEm = false;
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "emphasis")) hasEm = true;
    });
    expect(hasEm).toBe(true);
  });

  it("basic emphasis with underscores", () => {
    const doc = parseMarkdown("_foo bar_\n");
    const para = doc.firstChild!;
    let hasEm = false;
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "emphasis")) hasEm = true;
    });
    expect(hasEm).toBe(true);
  });

  it("strong emphasis with double asterisks", () => {
    const doc = parseMarkdown("**foo bar**\n");
    const para = doc.firstChild!;
    let hasStrong = false;
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "strong")) hasStrong = true;
    });
    expect(hasStrong).toBe(true);
  });

  it("nested emphasis: bold inside italic", () => {
    const doc = parseMarkdown("*foo **bar** baz*\n");
    const para = doc.firstChild!;
    let hasBothMarks = false;
    para.forEach((child) => {
      const markNames = child.marks.map((m) => m.type.name);
      if (markNames.includes("emphasis") && markNames.includes("strong")) {
        hasBothMarks = true;
      }
    });
    expect(hasBothMarks).toBe(true);
  });
});

describe("CommonMark: Code spans", () => {
  it("basic code span", () => {
    const doc = parseMarkdown("`foo`\n");
    const para = doc.firstChild!;
    let hasCode = false;
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "inline_code")) hasCode = true;
    });
    expect(hasCode).toBe(true);
  });

  it("code span with backtick inside", () => {
    const doc = parseMarkdown("`` foo ` bar ``\n");
    const para = doc.firstChild!;
    let codeText = "";
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "inline_code")) {
        codeText = child.text ?? "";
      }
    });
    expect(codeText).toContain("`");
  });
});

describe("CommonMark: Links", () => {
  it("inline link (example 482)", () => {
    const doc = parseMarkdown("[link](/url)\n");
    const para = doc.firstChild!;
    let linkMark: { url: string; title: string | null } | null = null;
    para.forEach((child) => {
      const mark = child.marks.find((m) => m.type.name === "link");
      if (mark) linkMark = mark.attrs as { url: string; title: string | null };
    });
    expect(linkMark).toBeTruthy();
    expect(linkMark!.url).toBe("/url");
  });

  it("link with title", () => {
    const doc = parseMarkdown('[link](/url "title")\n');
    const para = doc.firstChild!;
    let linkMark: { url: string; title: string | null } | null = null;
    para.forEach((child) => {
      const mark = child.marks.find((m) => m.type.name === "link");
      if (mark) linkMark = mark.attrs as { url: string; title: string | null };
    });
    expect(linkMark!.title).toBe("title");
  });

  it("reference link (example 192)", () => {
    const doc = parseMarkdown('[foo]: /url "title"\n\n[foo]\n');
    // Should produce a paragraph with a link
    let found = false;
    doc.descendants((node) => {
      if (node.marks.some((m) => m.type.name === "link")) {
        const mark = node.marks.find((m) => m.type.name === "link")!;
        expect(mark.attrs.url).toBe("/url");
        expect(mark.attrs.title).toBe("title");
        found = true;
      }
    });
    expect(found).toBe(true);
  });
});

describe("CommonMark: Images", () => {
  it("inline image", () => {
    const doc = parseMarkdown("![foo](/url)\n");
    let found = false;
    doc.descendants((node) => {
      if (node.type.name === "image") {
        expect(node.attrs.url).toBe("/url");
        expect(node.attrs.alt).toBe("foo");
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("image with title", () => {
    const doc = parseMarkdown('![foo](/url "title")\n');
    let found = false;
    doc.descendants((node) => {
      if (node.type.name === "image") {
        expect(node.attrs.title).toBe("title");
        found = true;
      }
    });
    expect(found).toBe(true);
  });
});

describe("CommonMark: Hard line breaks", () => {
  it("trailing spaces create hard break (example 630 area)", () => {
    const doc = parseMarkdown("foo  \nbar\n");
    let hasBreak = false;
    doc.descendants((node) => {
      if (node.type.name === "break") hasBreak = true;
    });
    expect(hasBreak).toBe(true);
  });

  it("backslash creates hard break", () => {
    const doc = parseMarkdown("foo\\\nbar\n");
    let hasBreak = false;
    doc.descendants((node) => {
      if (node.type.name === "break") hasBreak = true;
    });
    expect(hasBreak).toBe(true);
  });
});

describe("CommonMark: Paragraphs", () => {
  it("two paragraphs separated by blank line (example 219)", () => {
    const doc = parseMarkdown("aaa\n\nbbb\n");
    let paraCount = 0;
    doc.forEach((node) => {
      if (node.type.name === "paragraph") paraCount++;
    });
    expect(paraCount).toBe(2);
  });
});

describe("CommonMark: Backslash escapes", () => {
  it("escaped punctuation (example 12)", () => {
    const doc = parseMarkdown(
      "\\!\\\"\\#\\$\\%\\&\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~\n",
    );
    expect(doc.firstChild?.type.name).toBe("paragraph");
    const text = doc.firstChild!.textContent;
    expect(text).toContain("!");
    expect(text).toContain("*");
    expect(text).toContain("\\");
  });
});
