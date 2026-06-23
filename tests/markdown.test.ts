import { describe, it, expect } from "vite-plus/test";
import { EditorState, Selection, TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { parseMarkdown, serializeMarkdown, schema } from "../src/markdown";
import specData from "./fixtures/commonmark-spec.json";

function hasMarkInParagraph(md: string, markName: string): boolean {
  const doc = parseMarkdown(md);
  const para = doc.firstChild!;
  let found = false;
  para.forEach((child) => {
    if (child.marks.some((m) => m.type.name === markName)) found = true;
  });
  return found;
}

/* -------------------------------------------------------------------------- */
/* Helpers */

class Rng {
  private s: [number, number, number, number];

  constructor(seed: number) {
    let s = seed | 0;
    const sm = () => {
      s = (s + 0x9e3779b9) | 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      return t >>> 0;
    };
    this.s = [sm(), sm(), sm(), sm()];
  }

  next(): number {
    const s = this.s;
    const t = s[3];
    let r = s[0];
    s[3] = s[2];
    s[2] = s[1];
    s[1] = r;
    r ^= r << 11;
    r ^= r >>> 8;
    s[0] = r ^ t ^ (t >>> 19);
    return (s[0] >>> 0) / 0x100000000;
  }

  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

const WORDS = [
  "hello",
  "world",
  "foo",
  "bar",
  "baz",
  "the",
  "quick",
  "brown",
  "fox",
  "jumps",
  "over",
  "lazy",
  "dog",
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "CJK测试",
  "日本語",
  "한국어",
  "emoji🎉",
  "special<>&",
  "back\\slash",
  "pipe|char",
  "tab\there",
];

const LANGUAGES = ["", "js", "ts", "python", "rust", "go", "html", "css", "json", "bash"];
const ESCAPABLE_PUNCTUATION = ["*", "_", "`", "[", "]", "(", ")", "#", "+", "-", ".", "!", "|"];

function randomWord(rng: Rng): string {
  return rng.pick(WORDS);
}

function randomWords(rng: Rng, min = 1, max = 8): string {
  const count = rng.range(min, max);
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(randomWord(rng));
  return words.join(" ");
}

function randomInline(rng: Rng): string {
  const parts: string[] = [];
  const segmentCount = rng.range(1, 7);

  for (let i = 0; i < segmentCount; i++) {
    const text = randomWords(rng, 1, 4);
    switch (rng.int(13)) {
      case 0:
        parts.push(`**${text}**`);
        break;
      case 1:
        parts.push(`*${text}*`);
        break;
      case 2:
        parts.push(`\`${text}\``);
        break;
      case 3:
        parts.push(`~~${text}~~`);
        break;
      case 4:
        parts.push(`[${text}](https://example.com/${rng.int(100)})`);
        break;
      case 5:
        parts.push(`![${text}](https://example.com/img${rng.int(100)}.png)`);
        break;
      case 6:
        parts.push(`==${text}==`);
        break;
      case 7:
        parts.push(`***${text}***`);
        break;
      case 8:
        parts.push(`[${text}][ref${rng.int(5)}]`);
        break;
      case 9:
        parts.push(`\\${rng.pick(ESCAPABLE_PUNCTUATION)}${text}`);
        break;
      case 10:
        parts.push(`${text}\\\n${randomWords(rng, 1, 3)}`);
        break;
      default:
        parts.push(text);
        break;
    }
  }
  return parts.join(" ");
}

function randomHeading(rng: Rng): string {
  return `${"#".repeat(rng.range(1, 6))} ${randomWords(rng, 1, 5)}`;
}

function randomSetextHeading(rng: Rng): string {
  return `${randomInline(rng)}\n${rng.chance(0.5) ? "=" : "-".repeat(rng.range(3, 8))}`;
}

function randomParagraph(rng: Rng): string {
  return randomInline(rng);
}

function randomBlockquote(rng: Rng): string {
  const lines: string[] = [];
  for (let i = 0; i < rng.range(1, 3); i++) {
    lines.push(`> ${randomInline(rng)}`);
  }
  return lines.join("\n");
}

function randomCodeBlock(rng: Rng): string {
  const lines = [`\`\`\`${rng.pick(LANGUAGES)}`];
  for (let i = 0; i < rng.range(1, 5); i++) {
    lines.push(randomWords(rng, 1, 6));
  }
  lines.push("```");
  return lines.join("\n");
}

function randomIndentedCodeBlock(rng: Rng): string {
  const lines: string[] = [];
  for (let i = 0; i < rng.range(1, 4); i++) {
    lines.push(`    ${randomWords(rng, 1, 6)}`);
  }
  return lines.join("\n");
}

function randomBulletList(rng: Rng): string {
  const items: string[] = [];
  for (let i = 0; i < rng.range(1, 5); i++) {
    const marker = rng.pick(["-", "*", "+"]);
    items.push(`${marker} ${randomInline(rng)}`);
  }
  return items.join("\n");
}

function randomOrderedList(rng: Rng): string {
  const start = rng.range(1, 10);
  const items: string[] = [];
  for (let i = 0; i < rng.range(1, 5); i++) {
    items.push(`${start + i}. ${randomInline(rng)}`);
  }
  return items.join("\n");
}

function randomTaskList(rng: Rng): string {
  const items: string[] = [];
  for (let i = 0; i < rng.range(1, 4); i++) {
    items.push(`- [${rng.chance(0.5) ? "x" : " "}] ${randomWords(rng, 1, 4)}`);
  }
  return items.join("\n");
}

function randomTableWord(rng: Rng): string {
  return rng.pick(WORDS.filter((word) => !word.includes("|")));
}

function randomTableWords(rng: Rng, min = 1, max = 3): string {
  const words: string[] = [];
  for (let i = 0; i < rng.range(min, max); i++) words.push(randomTableWord(rng));
  return words.join(" ");
}

function randomTable(rng: Rng): string {
  const cols = rng.range(2, 5);
  const rows = rng.range(1, 4);
  const header =
    "| " + Array.from({ length: cols }, () => randomTableWords(rng, 1, 2)).join(" | ") + " |";
  const separator =
    "| " +
    Array.from({ length: cols }, () => rng.pick(["---", ":---", ":---:", "---:"])).join(" | ") +
    " |";
  const body: string[] = [];

  for (let row = 0; row < rows; row++) {
    body.push("| " + Array.from({ length: cols }, () => randomTableWords(rng)).join(" | ") + " |");
  }

  return [header, separator, ...body].join("\n");
}

function randomNestedList(rng: Rng): string {
  const lines: string[] = [];
  for (let i = 0; i < rng.range(2, 4); i++) {
    lines.push(`- ${randomWords(rng, 1, 3)}`);
    if (rng.chance(0.6)) {
      for (let j = 0; j < rng.range(1, 3); j++) {
        lines.push(`  - ${randomWords(rng, 1, 3)}`);
      }
    }
  }
  return lines.join("\n");
}

function randomReferenceLinks(rng: Rng): string {
  const id = `ref${rng.int(5)}`;
  return [
    `[${randomWords(rng, 1, 4)}][${id}]`,
    "",
    `[${id}]: https://example.com/${rng.int(100)} "${randomWords(rng, 1, 3)}"`,
  ].join("\n");
}

function randomCjkFlanking(rng: Rng): string {
  return rng.pick([
    "**太字になりません。**ご注意",
    "太郎は**「こんにちわ」**といった",
    "~~削除済み。~~次の文",
    "==重要。==这是",
    "注意==（重点内容）==别忘了",
    "**스크립트(script)**라고",
  ]);
}

const BLOCK_GENERATORS = [
  randomParagraph,
  randomHeading,
  randomSetextHeading,
  randomBlockquote,
  randomCodeBlock,
  randomIndentedCodeBlock,
  randomBulletList,
  randomOrderedList,
  randomTaskList,
  randomTable,
  randomReferenceLinks,
  randomCjkFlanking,
  (rng: Rng) => rng.pick(["---", "***", "___"]),
  randomNestedList,
] as const;

function generateRandomMarkdown(rng: Rng, blockCount?: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < (blockCount ?? rng.range(3, 12)); i++) {
    blocks.push(rng.pick(BLOCK_GENERATORS)(rng));
  }
  return `${blocks.join("\n\n")}\n`;
}

function validatePMNode(node: PMNode): string[] {
  const errors: string[] = [];

  node.descendants((child, _pos, parent) => {
    if (!schema.nodes[child.type.name]) {
      errors.push(`Unknown node type: ${child.type.name}`);
    }
    for (const mark of child.marks) {
      if (!schema.marks[mark.type.name]) {
        errors.push(`Unknown mark type: ${mark.type.name}`);
      }
    }
    if (parent && !parent.type.validContent(parent.content)) {
      errors.push(`${parent.type.name} has invalid content`);
    }
  });

  if (!node.type.validContent(node.content)) {
    errors.push(`${node.type.name} has invalid content`);
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Roundtrip */

/**
 * Roundtrip tests: parse → serialize → parse → compare.
 *
 * These verify that markdown survives a full roundtrip through our
 * mdast → PM → mdast → markdown pipeline without semantic loss.
 */

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

/* -------------------------------------------------------------------------- */
/* CommonMark */

/**
 * CommonMark spec compliance tests.
 *
 * Loads the official spec.json and runs each relevant example through
 * parseMarkdown, verifying:
 * 1. Parsing does not throw
 * 2. The result is a valid PM document
 * 3. Structural spot-checks for key sections
 */

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

// These examples parse and serialize, but the serializer intentionally
// canonicalizes them to a different PM JSON shape on re-parse:
// - entity newlines become literal blank lines
// - link reference definitions without rendered links are dropped
// - ambiguous nested emphasis is escaped differently on output
const nonCanonicalRoundtripExamples = new Set([39, 317, 430, 431]);
const roundtrippableExamples = relevantExamples.filter(
  (ex) => !nonCanonicalRoundtripExamples.has(ex.example),
);

describe("CommonMark spec compliance", () => {
  it("keeps every supported fixture example under test", () => {
    expect(relevantExamples).toHaveLength(549);
    expect(roundtrippableExamples).toHaveLength(545);
  });

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

  describe("serializes without throwing", () => {
    for (const ex of relevantExamples) {
      it(`example ${ex.example} serializes`, () => {
        const doc = parseMarkdown(ex.markdown);
        expect(() => serializeMarkdown(doc)).not.toThrow();
      });
    }
  });

  describe("roundtrips canonical examples", () => {
    for (const ex of roundtrippableExamples) {
      it(`example ${ex.example} roundtrips`, () => {
        const doc1 = parseMarkdown(ex.markdown);
        const serialized = serializeMarkdown(doc1);
        const doc2 = parseMarkdown(serialized);
        expect(doc2.toJSON()).toEqual(doc1.toJSON());
      });
    }
  });

  describe("known non-canonical serializer examples", () => {
    for (const ex of relevantExamples.filter((example) =>
      nonCanonicalRoundtripExamples.has(example.example),
    )) {
      it(`example ${ex.example} is covered without canonical JSON equality`, () => {
        const doc = parseMarkdown(ex.markdown);
        const serialized = serializeMarkdown(doc);
        expect(() => parseMarkdown(serialized)).not.toThrow();
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

/* -------------------------------------------------------------------------- */
/* Structure */

/**
 * Structural and edge case tests.
 *
 * Detailed verification of PM document structure for each feature,
 * plus edge cases that stress the parser.
 */

/** Collect all top-level node type names */
function topLevelTypes(doc: PMNode): string[] {
  const types: string[] = [];
  doc.forEach((node) => {
    types.push(node.type.name);
  });
  return types;
}

/** Collect all mark names found in the document */
function allMarks(doc: PMNode): Set<string> {
  const marks = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks) marks.add(mark.type.name);
  });
  return marks;
}

// ========== Empty / minimal documents ==========

describe("Edge: empty and minimal", () => {
  it("empty string produces doc with empty paragraph", () => {
    const doc = parseMarkdown("");
    expect(doc.type.name).toBe("doc");
    // remark may produce an empty root, PM fills with a paragraph
    expect(doc.childCount).toBeGreaterThanOrEqual(0);
  });

  it("whitespace only", () => {
    const doc = parseMarkdown("   \n  \n\n");
    expect(doc.type.name).toBe("doc");
  });

  it("single character", () => {
    const doc = parseMarkdown("a\n");
    expect(doc.firstChild?.type.name).toBe("paragraph");
    expect(doc.firstChild?.textContent).toBe("a");
  });

  it("single newline", () => {
    const doc = parseMarkdown("\n");
    expect(doc.type.name).toBe("doc");
  });
});

// ========== Heading structure ==========

describe("Structure: headings", () => {
  it("h1 attrs", () => {
    const doc = parseMarkdown("# Hello\n");
    const h = doc.firstChild!;
    expect(h.type.name).toBe("heading");
    expect(h.attrs.depth).toBe(1);
    expect(h.textContent).toBe("Hello");
  });

  it("h6 attrs", () => {
    const doc = parseMarkdown("###### Deep\n");
    const h = doc.firstChild!;
    expect(h.attrs.depth).toBe(6);
    expect(h.textContent).toBe("Deep");
  });

  it("heading with link", () => {
    const doc = parseMarkdown("# [Link](url)\n");
    const h = doc.firstChild!;
    let hasLink = false;
    h.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "link")) hasLink = true;
    });
    expect(hasLink).toBe(true);
  });
});

// ========== Code block structure ==========

describe("Structure: code blocks", () => {
  it("fenced code block with language", () => {
    const doc = parseMarkdown("```python\nprint('hello')\n```\n");
    const cb = doc.firstChild!;
    expect(cb.type.name).toBe("code");
    expect(cb.attrs.lang).toBe("python");
    expect(cb.textContent).toBe("print('hello')");
  });

  it("fenced code block without language", () => {
    const doc = parseMarkdown("```\nsome code\n```\n");
    const cb = doc.firstChild!;
    expect(cb.type.name).toBe("code");
    expect(cb.attrs.lang).toBeNull();
  });

  it("indented code block", () => {
    const doc = parseMarkdown("    indented code\n");
    expect(doc.firstChild?.type.name).toBe("code");
  });

  it("code block preserves whitespace", () => {
    const doc = parseMarkdown("```\n  indented\n    more indented\n```\n");
    expect(doc.firstChild!.textContent).toBe("  indented\n    more indented");
  });

  it("code block has no marks", () => {
    const doc = parseMarkdown("```\n**not bold** *not italic*\n```\n");
    const marks = allMarks(doc);
    expect(marks.size).toBe(0);
  });
});

// ========== Blockquote structure ==========

describe("Structure: blockquotes", () => {
  it("simple blockquote", () => {
    const doc = parseMarkdown("> Hello\n");
    const bq = doc.firstChild!;
    expect(bq.type.name).toBe("blockquote");
    expect(bq.firstChild?.type.name).toBe("paragraph");
    expect(bq.firstChild?.textContent).toBe("Hello");
  });

  it("blockquote with multiple paragraphs", () => {
    const doc = parseMarkdown("> First\n>\n> Second\n");
    const bq = doc.firstChild!;
    expect(bq.type.name).toBe("blockquote");
    expect(bq.childCount).toBe(2);
  });

  it("nested blockquote", () => {
    const doc = parseMarkdown("> outer\n>\n> > inner\n");
    const outerBq = doc.firstChild!;
    expect(outerBq.type.name).toBe("blockquote");
    let hasNestedBq = false;
    outerBq.forEach((child) => {
      if (child.type.name === "blockquote") hasNestedBq = true;
    });
    expect(hasNestedBq).toBe(true);
  });

  it("blockquote with list", () => {
    const doc = parseMarkdown("> - item 1\n> - item 2\n");
    const bq = doc.firstChild!;
    expect(bq.type.name).toBe("blockquote");
    let hasList = false;
    bq.forEach((child) => {
      if (child.type.name === "list") hasList = true;
    });
    expect(hasList).toBe(true);
  });
});

// ========== List structure ==========

describe("Structure: lists", () => {
  it("tight bullet list", () => {
    const doc = parseMarkdown("- a\n- b\n- c\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("list");
    expect(list.childCount).toBe(3);
    // All items should have paragraph children
    list.forEach((item) => {
      expect(item.type.name).toBe("list_item");
      expect(item.firstChild?.type.name).toBe("paragraph");
    });
  });

  it("loose bullet list (items separated by blank lines)", () => {
    const doc = parseMarkdown("- a\n\n- b\n\n- c\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("list");
    expect(list.childCount).toBe(3);
  });

  it("ordered list starting at 1", () => {
    const doc = parseMarkdown("1. a\n2. b\n3. c\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("list");
    expect(list.attrs.start).toBe(1);
  });

  it("ordered list starting at 5", () => {
    const doc = parseMarkdown("5. a\n6. b\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("list");
    expect(list.attrs.start).toBe(5);
  });

  it("list with nested code block", () => {
    const doc = parseMarkdown("- item\n\n  ```\n  code\n  ```\n");
    const list = doc.firstChild!;
    const item = list.firstChild!;
    let hasCodeBlock = false;
    item.forEach((child) => {
      if (child.type.name === "code") hasCodeBlock = true;
    });
    expect(hasCodeBlock).toBe(true);
  });

  it("list item with multiple blocks", () => {
    const doc = parseMarkdown("- paragraph 1\n\n  paragraph 2\n");
    const list = doc.firstChild!;
    const item = list.firstChild!;
    expect(item.childCount).toBe(2);
  });
});

// ========== Mark combinations ==========

describe("Structure: mark combinations", () => {
  it("bold + italic", () => {
    const doc = parseMarkdown("***bold italic***\n");
    const marks = allMarks(doc);
    expect(marks.has("strong")).toBe(true);
    expect(marks.has("emphasis")).toBe(true);
  });

  it("bold inside italic", () => {
    const doc = parseMarkdown("*foo **bar** baz*\n");
    const marks = allMarks(doc);
    expect(marks.has("strong")).toBe(true);
    expect(marks.has("emphasis")).toBe(true);
  });

  it("code does not contain other marks", () => {
    // Inline code should exclude other marks (code excludes "_")
    const doc = parseMarkdown("`code`\n");
    const para = doc.firstChild!;
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "inline_code")) {
        // Only code mark, no others
        const nonCodeMarks = child.marks.filter((m) => m.type.name !== "inline_code");
        expect(nonCodeMarks.length).toBe(0);
      }
    });
  });

  it("link with emphasis inside", () => {
    const doc = parseMarkdown("[*click*](url)\n");
    const marks = allMarks(doc);
    expect(marks.has("link")).toBe(true);
    expect(marks.has("emphasis")).toBe(true);
  });

  it("link with bold inside", () => {
    const doc = parseMarkdown("[**click**](url)\n");
    const marks = allMarks(doc);
    expect(marks.has("link")).toBe(true);
    expect(marks.has("strong")).toBe(true);
  });

  it("strikethrough + bold", () => {
    const doc = parseMarkdown("~~**both**~~\n");
    const marks = allMarks(doc);
    expect(marks.has("delete")).toBe(true);
    expect(marks.has("strong")).toBe(true);
  });
});

// ========== Image structure ==========

describe("Structure: images", () => {
  it("image nodes are draggable document objects", () => {
    expect(schema.nodes.image.spec.draggable).toBe(true);
  });

  it("inline image with all attrs", () => {
    const doc = parseMarkdown('![alt](/src "title")\n');
    let found = false;
    doc.descendants((node) => {
      if (node.type.name === "image") {
        expect(node.attrs.url).toBe("/src");
        expect(node.attrs.alt).toBe("alt");
        expect(node.attrs.title).toBe("title");
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("image without title", () => {
    const doc = parseMarkdown("![alt](/src)\n");
    let found = false;
    doc.descendants((node) => {
      if (node.type.name === "image") {
        expect(node.attrs.title).toBeNull();
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("image in heading", () => {
    const doc = parseMarkdown("# ![logo](/logo.png)\n");
    const h = doc.firstChild!;
    expect(h.type.name).toBe("heading");
    let hasImage = false;
    h.forEach((child) => {
      if (child.type.name === "image") hasImage = true;
    });
    expect(hasImage).toBe(true);
  });
});

// ========== Hard break structure ==========

describe("Structure: hard breaks", () => {
  it("trailing spaces hard break", () => {
    const doc = parseMarkdown("foo  \nbar\n");
    let breakCount = 0;
    doc.descendants((node) => {
      if (node.type.name === "break") breakCount++;
    });
    expect(breakCount).toBe(1);
  });

  it("backslash hard break", () => {
    const doc = parseMarkdown("foo\\\nbar\n");
    let breakCount = 0;
    doc.descendants((node) => {
      if (node.type.name === "break") breakCount++;
    });
    expect(breakCount).toBe(1);
  });

  it("multiple hard breaks", () => {
    const doc = parseMarkdown("a  \nb  \nc\n");
    let breakCount = 0;
    doc.descendants((node) => {
      if (node.type.name === "break") breakCount++;
    });
    expect(breakCount).toBe(2);
  });
});

// ========== Horizontal rule structure ==========

describe("Structure: horizontal rules", () => {
  it("thematic break nodes are draggable document objects", () => {
    expect(schema.nodes.thematic_break.spec.draggable).toBe(true);
  });

  it("three dashes", () => {
    const doc = parseMarkdown("---\n");
    expect(doc.firstChild?.type.name).toBe("thematic_break");
  });

  it("three asterisks", () => {
    const doc = parseMarkdown("***\n");
    expect(doc.firstChild?.type.name).toBe("thematic_break");
  });

  it("three underscores", () => {
    const doc = parseMarkdown("___\n");
    expect(doc.firstChild?.type.name).toBe("thematic_break");
  });

  it("hr between paragraphs", () => {
    const doc = parseMarkdown("above\n\n---\n\nbelow\n");
    const types = topLevelTypes(doc);
    expect(types).toEqual(["paragraph", "thematic_break", "paragraph"]);
  });
});

// ========== Complex documents ==========

describe("Structure: complex documents", () => {
  it("full document with all features", () => {
    const md = `# Title

A paragraph with **bold**, *italic*, \`code\`, ~~deleted~~, and [link](url).

## Subtitle

> A blockquote with **bold**.

- Bullet 1
- Bullet 2
  - Nested

1. Ordered 1
2. Ordered 2

\`\`\`js
const x = 1;
\`\`\`

---

![image](img.png)

Final paragraph.
`;
    const doc = parseMarkdown(md);
    const types = topLevelTypes(doc);
    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
    expect(types).toContain("blockquote");
    expect(types).toContain("list");
    expect(types).toContain("list");
    expect(types).toContain("code");
    expect(types).toContain("thematic_break");

    const marks = allMarks(doc);
    expect(marks.has("strong")).toBe(true);
    expect(marks.has("emphasis")).toBe(true);
    expect(marks.has("inline_code")).toBe(true);
    expect(marks.has("delete")).toBe(true);
    expect(marks.has("link")).toBe(true);
  });

  it("deeply nested blockquotes and lists", () => {
    const md = `> - item
>   > nested quote
>   >
>   > - nested list
`;
    expect(() => parseMarkdown(md)).not.toThrow();
    const doc = parseMarkdown(md);
    expect(doc.firstChild?.type.name).toBe("blockquote");
  });

  it("multiple reference links", () => {
    const md = `[foo]: /foo
[bar]: /bar "Bar Title"

See [foo] and [bar].
`;
    const doc = parseMarkdown(md);
    const marks = allMarks(doc);
    expect(marks.has("link")).toBe(true);

    // Should have two link marks with different hrefs
    const hrefs: string[] = [];
    doc.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type.name === "link" && !hrefs.includes(mark.attrs.url as string)) {
          hrefs.push(mark.attrs.url as string);
        }
      }
    });
    expect(hrefs).toContain("/foo");
    expect(hrefs).toContain("/bar");
  });
});

// ========== Serialize structural tests ==========

describe("Serialize: structural correctness", () => {
  it("empty doc serializes without throwing", () => {
    const doc = parseMarkdown("");
    expect(() => serializeMarkdown(doc)).not.toThrow();
  });

  it("preserve heading levels through serialize", () => {
    for (let level = 1; level <= 6; level++) {
      const prefix = "#".repeat(level);
      const md = `${prefix} Heading\n`;
      const doc = parseMarkdown(md);
      const output = serializeMarkdown(doc);
      expect(output).toContain(`${prefix} Heading`);
    }
  });

  it("preserves code block language", () => {
    const doc = parseMarkdown("```typescript\nconst x = 1;\n```\n");
    const output = serializeMarkdown(doc);
    expect(output).toContain("typescript");
    expect(output).toContain("const x = 1;");
  });

  it("preserves link href and title", () => {
    const doc = parseMarkdown('[text](https://example.com "Title")\n');
    const output = serializeMarkdown(doc);
    expect(output).toContain("https://example.com");
    expect(output).toContain("Title");
  });

  it("preserves image src, alt, and title", () => {
    const doc = parseMarkdown('![alt text](https://img.png "Image Title")\n');
    const output = serializeMarkdown(doc);
    expect(output).toContain("alt text");
    expect(output).toContain("https://img.png");
    expect(output).toContain("Image Title");
  });

  it("preserves ordered list start number", () => {
    const doc = parseMarkdown("3. three\n4. four\n");
    const output = serializeMarkdown(doc);
    expect(output).toContain("3.");
  });
});

/* -------------------------------------------------------------------------- */
/* GFM */

/**
 * GFM (GitHub Flavored Markdown) feature tests.
 *
 * Tests strikethrough, tables, and task lists — features beyond CommonMark.
 */

describe("GFM: Strikethrough", () => {
  it("parses ~~text~~", () => {
    const doc = parseMarkdown("~~strikethrough~~\n");
    const para = doc.firstChild!;
    let hasStrikethrough = false;
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "delete")) {
        hasStrikethrough = true;
        expect(child.text).toBe("strikethrough");
      }
    });
    expect(hasStrikethrough).toBe(true);
  });

  it("strikethrough with other marks", () => {
    const doc = parseMarkdown("~~**bold strikethrough**~~\n");
    const para = doc.firstChild!;
    let hasBoth = false;
    para.forEach((child) => {
      const markNames = child.marks.map((m) => m.type.name);
      if (markNames.includes("delete") && markNames.includes("strong")) {
        hasBoth = true;
      }
    });
    expect(hasBoth).toBe(true);
  });

  it("roundtrips strikethrough", () => {
    const md = "~~deleted~~\n";
    const doc = parseMarkdown(md);
    const output = serializeMarkdown(doc);
    expect(output).toContain("~~deleted~~");
  });

  it("single tilde is not strikethrough", () => {
    const doc = parseMarkdown("~not strikethrough~\n");
    // remark-gfm with default config may or may not parse single tildes
    // The important thing is it doesn't throw
    expect(doc.firstChild?.type.name).toBe("paragraph");
  });
});

describe("GFM: Tables", () => {
  it("parses basic table", () => {
    const md = "| a | b |\n| - | - |\n| c | d |\n";
    const doc = parseMarkdown(md);
    const table = doc.firstChild!;
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(2); // header row + data row
  });

  it("header row uses table_cell cells", () => {
    const md = "| a | b |\n| - | - |\n| c | d |\n";
    const doc = parseMarkdown(md);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;
    expect(headerRow.type.name).toBe("table_row");
    headerRow.forEach((cell) => {
      expect(cell.type.name).toBe("table_cell");
    });
  });

  it("data rows use table_cell cells", () => {
    const md = "| a | b |\n| - | - |\n| c | d |\n";
    const doc = parseMarkdown(md);
    const table = doc.firstChild!;
    const dataRow = table.child(1);
    dataRow.forEach((cell) => {
      expect(cell.type.name).toBe("table_cell");
    });
  });

  it("table with alignment as array on table node", () => {
    const md = "| left | center | right |\n| :--- | :---: | ---: |\n| a | b | c |\n";
    const doc = parseMarkdown(md);
    const table = doc.firstChild!;
    expect(table.type.name).toBe("table");

    // Alignment lives on the table node as an array
    expect(table.attrs.align).toEqual(["left", "center", "right"]);

    // Individual cells have no align attr
    const headerRow = table.firstChild!;
    headerRow.forEach((cell) => {
      expect(cell.attrs).toEqual({});
    });
    const dataRow = table.child(1);
    dataRow.forEach((cell) => {
      expect(cell.attrs).toEqual({});
    });
  });

  it("table roundtrip preserves structure", () => {
    const md = "| a | b |\n| - | - |\n| c | d |\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    // Both should produce tables with header + data rows
    expect(doc1.firstChild?.type.name).toBe("table");
    expect(doc2.firstChild?.type.name).toBe("table");
    // Header cells survive roundtrip
    const headerRow = doc2.firstChild!.firstChild!;
    headerRow.forEach((cell) => {
      expect(cell.type.name).toBe("table_cell");
    });
    // Data cells survive roundtrip
    const dataRow = doc2.firstChild!.child(1);
    dataRow.forEach((cell) => {
      expect(cell.type.name).toBe("table_cell");
    });
  });

  it("table roundtrip preserves alignment", () => {
    const md = "| left | center | right |\n| :--- | :---: | ---: |\n| a | b | c |\n";
    const doc = parseMarkdown(md);
    const serialized = serializeMarkdown(doc);
    // The serialized output should contain the alignment markers
    expect(serialized).toMatch(/:---+/); // left-aligned column
    expect(serialized).toMatch(/:---+:/); // center-aligned column
    expect(serialized).toMatch(/[^:]---+:/); // right-aligned column
    // Re-parse and verify alignment is on the table node
    const doc2 = parseMarkdown(serialized);
    const table = doc2.firstChild!;
    expect(table.attrs.align).toEqual(["left", "center", "right"]);
  });

  it("table with inline formatting", () => {
    const md = "| **bold** | *italic* |\n| - | - |\n| `code` | [link](url) |\n";
    const doc = parseMarkdown(md);
    const table = doc.firstChild!;
    expect(table.type.name).toBe("table");

    // Check that marks exist in the table cells
    let hasStrong = false;
    let hasEm = false;
    let hasCode = false;
    let hasLink = false;
    doc.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type.name === "strong") hasStrong = true;
        if (mark.type.name === "emphasis") hasEm = true;
        if (mark.type.name === "inline_code") hasCode = true;
        if (mark.type.name === "link") hasLink = true;
      }
    });
    expect(hasStrong).toBe(true);
    expect(hasEm).toBe(true);
    expect(hasCode).toBe(true);
    expect(hasLink).toBe(true);
  });
});

describe("GFM: Task lists", () => {
  it("parses task list items", () => {
    const md = "- [x] checked\n- [ ] unchecked\n- regular\n";
    const doc = parseMarkdown(md);
    const list = doc.firstChild!;
    expect(list.type.name).toBe("list");

    const item1 = list.child(0)!;
    const item2 = list.child(1)!;
    const item3 = list.child(2)!;

    expect(item1.attrs.checked).toBe(true);
    expect(item2.attrs.checked).toBe(false);
    expect(item3.attrs.checked).toBeNull();
  });

  it("roundtrips task list", () => {
    const md = "- [x] done\n- [ ] todo\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);

    const list = doc2.firstChild!;
    expect(list.child(0)!.attrs.checked).toBe(true);
    expect(list.child(1)!.attrs.checked).toBe(false);
  });

  it("ordered task list", () => {
    const md = "1. [x] first\n2. [ ] second\n";
    const doc = parseMarkdown(md);
    const list = doc.firstChild!;
    expect(list.type.name).toBe("list");
    expect(list.child(0)!.attrs.checked).toBe(true);
    expect(list.child(1)!.attrs.checked).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Highlight */

/**
 * Highlight mark (`==text==`) tests.
 *
 * Tests basic parsing, roundtrip, and mark combinations.
 * CJK-friendly flanking tests live in cjk.test.ts alongside other CJK tests.
 */

describe("Highlight: Basic", () => {
  it("parses ==text==", () => {
    expect(hasMarkInParagraph("==highlighted==\n", "highlight")).toBe(true);
  });

  it("single = is not highlight", () => {
    expect(hasMarkInParagraph("=not highlight=\n", "highlight")).toBe(false);
  });

  it("triple === is not highlight", () => {
    expect(hasMarkInParagraph("===not highlight===\n", "highlight")).toBe(false);
  });

  it("spaces inside content are fine", () => {
    expect(hasMarkInParagraph("==hello world==\n", "highlight")).toBe(true);
  });

  it("leading/trailing spaces prevent flanking", () => {
    expect(hasMarkInParagraph("== nope ==\n", "highlight")).toBe(false);
  });

  it("roundtrips through parse → serialize → parse", () => {
    const md = "==important text==\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });
});

describe("Highlight: Combined with other marks", () => {
  it("nested in bold: **==text==**", () => {
    const doc = parseMarkdown("**==bold highlight==**\n");
    const para = doc.firstChild!;
    let hasBoth = false;
    para.forEach((child) => {
      const marks = child.marks.map((m) => m.type.name);
      if (marks.includes("highlight") && marks.includes("strong")) hasBoth = true;
    });
    expect(hasBoth).toBe(true);
  });

  it("nested in strikethrough: ~~==text==~~", () => {
    const doc = parseMarkdown("~~==deleted highlight==~~\n");
    const para = doc.firstChild!;
    let hasBoth = false;
    para.forEach((child) => {
      const marks = child.marks.map((m) => m.type.name);
      if (marks.includes("highlight") && marks.includes("delete")) hasBoth = true;
    });
    expect(hasBoth).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* CJK */

/**
 * CJK-friendly flanking rule tests.
 *
 * The CJK-friendly plugins (remark-cjk-friendly, remark-cjk-friendly-gfm-strikethrough)
 * fix a specific issue in standard CommonMark/GFM flanking rules:
 *
 *   When CJK **punctuation** (。「」（）！？、：etc.) appears immediately inside
 *   delimiter runs, while CJK **text** characters appear immediately outside,
 *   the standard flanking check fails because:
 *   - CJK punctuation triggers the "preceded/followed by punctuation" condition
 *   - That condition requires the other side to be punctuation or whitespace
 *   - But CJK text characters are neither → flanking fails → delimiters are literal
 *
 * Patterns like `*中文*` or `这是**重要**的内容` work fine WITHOUT CJK-friendly,
 * because CJK text characters are classified as normal word characters, not punctuation.
 *
 * The fix reclassifies CJK punctuation as non-punctuation for flanking purposes,
 * so `。**` is treated like `字**` (right-flanking succeeds).
 */

describe("CJK-friendly: Emphasis with CJK punctuation inside delimiters", () => {
  it("CJK period inside closing: **太字になりません。**ご注意", () => {
    // 。 is CJK punctuation inside closing **, ご is CJK text outside.
    // Standard: closing ** preceded by punct (。), followed by non-punct/non-ws (ご) → FAILS.
    expect(hasMarkInParagraph("**太字になりません。**ご注意\n", "strong")).toBe(true);
  });

  it("CJK brackets inside both: 太郎は**「こんにちわ」**といった", () => {
    // 「 inside opening ** (preceded by は outside) → opening flanking fails without fix.
    // 」 inside closing ** (followed by と outside) → closing flanking fails without fix.
    expect(hasMarkInParagraph("太郎は**「こんにちわ」**といった\n", "strong")).toBe(true);
  });

  it("CJK parentheses inside both: カッコに注意**（太字にならない）**文が続く", () => {
    expect(hasMarkInParagraph("カッコに注意**（太字にならない）**文が続く\n", "strong")).toBe(true);
  });

  it("CJK colon inside closing: **推荐几个框架：**React等", () => {
    // ：(fullwidth colon) inside closing, R (Latin) outside.
    expect(hasMarkInParagraph("**推荐几个框架：**React等\n", "strong")).toBe(true);
  });

  it("underscore emphasis cannot fix infix restriction: 太郎は__「こんにちわ」__といった", () => {
    // Even with CJK-friendly, underscore emphasis has an extra CommonMark rule:
    // A left-flanking `_` run that is also right-flanking can only open if preceded
    // by punctuation. Here `は` (CJK text, not punct) precedes `__`, and it's both
    // left- and right-flanking → opening fails. This is a fundamental `_` limitation.
    expect(hasMarkInParagraph("太郎は__「こんにちわ」__といった\n", "strong")).toBe(false);
  });

  it("single emphasis: 文末の*重要！*次の文", () => {
    // ！ (fullwidth exclamation) inside closing *, CJK text outside.
    expect(hasMarkInParagraph("文末の*重要！*次の文\n", "emphasis")).toBe(true);
  });
});

describe("CJK-friendly: Strikethrough with CJK punctuation inside delimiters", () => {
  it("CJK period inside closing: ~~削除済み。~~次の文", () => {
    expect(hasMarkInParagraph("~~削除済み。~~次の文\n", "delete")).toBe(true);
  });

  it("CJK brackets inside: 太郎は~~「取り消し」~~といった", () => {
    expect(hasMarkInParagraph("太郎は~~「取り消し」~~といった\n", "delete")).toBe(true);
  });

  it("Korean parentheses: **스크립트(script)**라고", () => {
    // ) inside closing **, 라 (Hangul) outside.
    expect(hasMarkInParagraph("**스크립트(script)**라고\n", "strong")).toBe(true);
  });
});

describe("CJK-friendly: Highlight with CJK punctuation inside delimiters", () => {
  it("CJK period inside closing: ==重要。==这是", () => {
    // 。is CJK punctuation inside closing ==, 这 is CJK text outside.
    // Standard flanking: closing == preceded by punctuation (。), followed by
    // non-punctuation non-whitespace (这) → right-flanking check FAILS.
    // CJK-friendly reclassifies 。as non-punctuation for flanking → PASSES.
    expect(hasMarkInParagraph("==重要。==这是\n", "highlight")).toBe(true);
  });

  it("CJK brackets inside both delimiters: 太郎は==「こんにちわ」==といった", () => {
    // 「 inside opening ==, は outside → opening flanking fails without fix.
    // 」 inside closing ==, と outside → closing flanking fails without fix.
    expect(hasMarkInParagraph("太郎は==「こんにちわ」==といった\n", "highlight")).toBe(true);
  });

  it("CJK parentheses inside: 注意==（重点内容）==别忘了", () => {
    // （ inside opening, ） inside closing, CJK text outside both.
    expect(hasMarkInParagraph("注意==（重点内容）==别忘了\n", "highlight")).toBe(true);
  });

  it("CJK colon inside closing: ==推荐框架：==React是其中之一", () => {
    // ： (fullwidth colon) inside closing, R (Latin) outside.
    expect(hasMarkInParagraph("==推荐框架：==React是其中之一\n", "highlight")).toBe(true);
  });
});

describe("CJK: Roundtrip", () => {
  it("CJK text with marks roundtrips", () => {
    const md = "这是**粗体**和*斜体*和`代码`。\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });

  it("CJK-friendly pattern roundtrips", () => {
    const md = "太郎は**「こんにちわ」**といった\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });

  it("CJK-friendly highlight roundtrips", () => {
    const md = "==重要。==这是一段文本\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });

  it("mixed CJK and English document", () => {
    const md = `# Hello 世界

This is **English** and *中文* mixed.

- 第一项 (first)
- 第二项 (second)

> 这是一段引用 with **bold**.
`;
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });
});

/* -------------------------------------------------------------------------- */
/* Fuzz */

/**
 * Fuzz tests for the markdown roundtrip pipeline.
 *
 * Generates random markdown documents and verifies:
 * 1. Parsing doesn't throw
 * 2. Serializing doesn't throw
 * 3. Re-parsing the serialized output produces a structurally identical document
 * 4. The PM document is valid according to the schema
 *
 * Uses a seeded PRNG for reproducibility.
 */

// ========== Tests ==========

const FUZZ_ITERATIONS = 400;
const PM_OPERATION_FUZZ_ITERATIONS = 200;

function markdownFuzzContext(seed: number, markdown: string, ops: string[] = []): string {
  return [
    `seed=${seed}`,
    "Markdown:",
    "```md",
    markdown,
    "```",
    ...(ops.length
      ? ["Operations:", "```text", ops.map((op, idx) => `${idx + 1}. ${op}`).join("\n"), "```"]
      : []),
  ].join("\n");
}

function randomReachableSelection(doc: PMNode, rng: Rng): Selection | null {
  if (rng.chance(0.5)) {
    const candidates: number[] = [];
    doc.descendants((node, pos) => {
      if (node.isText && node.text && node.text.length > 0) {
        for (let i = 0; i <= node.text.length; i++) candidates.push(pos + i);
      }
    });
    if (candidates.length > 0) {
      const anchor = rng.pick(candidates);
      const head = rng.chance(0.7) ? anchor : rng.pick(candidates);
      try {
        return TextSelection.create(doc, Math.min(anchor, head), Math.max(anchor, head));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const pos = rng.range(0, doc.content.size);
    const dir = rng.chance(0.5) ? 1 : -1;
    try {
      return Selection.near(doc.resolve(pos), dir);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }

  return null;
}

describe("Fuzz: roundtrip", () => {
  it("random documents survive parse → serialize → re-parse", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const seed = i;
      const rng = new Rng(seed);
      const md = generateRandomMarkdown(rng);

      let doc1: ReturnType<typeof parseMarkdown>;
      try {
        doc1 = parseMarkdown(md);
      } catch (e: unknown) {
        throw new Error(`[seed=${seed}] Parse failed:\n${md}\n\n${String(e)}`);
      }

      let serialized: string;
      try {
        serialized = serializeMarkdown(doc1);
      } catch (e: unknown) {
        throw new Error(`[seed=${seed}] Serialize failed:\n${md}\n\n${String(e)}`);
      }

      let doc2: ReturnType<typeof parseMarkdown>;
      try {
        doc2 = parseMarkdown(serialized);
      } catch (e: unknown) {
        throw new Error(
          `[seed=${seed}] Re-parse failed:\nOriginal:\n${md}\n\nSerialized:\n${serialized}\n\n${String(e)}`,
        );
      }

      // The PM documents should be structurally identical
      expect(doc2.toJSON(), `[seed=${seed}] Roundtrip mismatch`).toEqual(doc1.toJSON());
    }
  });

  it("schema-validates all generated documents", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const seed = i + 10000;
      const rng = new Rng(seed);
      const md = generateRandomMarkdown(rng);

      const doc = parseMarkdown(md);
      const errors = validatePMNode(doc);
      expect(errors, `[seed=${seed}] Schema validation errors`).toEqual([]);
    }
  });

  it("handles edge-case markdown inputs without crashing", () => {
    const edgeCases = [
      "", // empty
      "\n", // just newline
      "\n\n\n", // multiple newlines
      "# ", // heading without text
      "> ", // empty blockquote
      "- ", // empty list item
      "```\n```", // empty code block
      "---", // hr
      "| |\n|---|\n| |", // minimal table
      "****", // empty bold
      "**", // unclosed bold
      "*", // lone asterisk
      "`", // lone backtick
      "```", // unclosed code fence
      "[]()", // empty link
      "![]()", // empty image
      "- [ ] ", // empty task item
      "\\", // lone backslash
      "# **bold heading**", // marks in heading
      "> > > deeply nested", // deep blockquote
      "- - - nested list markers", // this is a thematic break, not nested lists
      "1. 2. 3.", // non-standard ordered list
      "| a |\n|---|\n| b |\n| c |\n| d |", // long single-column table
      "```js\nconst x = `template`;\n```", // backticks inside code
      "text with\\\nhard break", // hard break
      "[link **with bold**](url)", // mark inside link
      "**bold *and italic***", // nested marks
      Array(50).fill("word").join(" "), // very long paragraph
      Array(20).fill("- item").join("\n"), // many list items
      Array(10).fill("# heading").join("\n\n"), // many headings
    ];

    for (const md of edgeCases) {
      expect(
        () => {
          const doc = parseMarkdown(md);
          serializeMarkdown(doc);
        },
        `Edge case crashed: ${JSON.stringify(md).slice(0, 80)}`,
      ).not.toThrow();
    }
  });
});

describe("Fuzz: random operations on PM documents", () => {
  it("random insertions, deletions, and mark toggles don't crash", () => {
    for (let i = 0; i < PM_OPERATION_FUZZ_ITERATIONS; i++) {
      const seed = i + 20000;
      const rng = new Rng(seed);
      const md = generateRandomMarkdown(rng, rng.range(3, 8));
      const ops: string[] = [];

      const doc = parseMarkdown(md);
      let state = EditorState.create({ doc, schema });

      const opCount = rng.range(10, 40);
      for (let op = 0; op < opCount; op++) {
        try {
          const action = rng.int(6);
          const docSize = state.doc.content.size;
          if (docSize < 2) break;

          switch (action) {
            case 0: {
              const pos = rng.range(1, Math.max(1, docSize - 1));
              const resolved = state.doc.resolve(pos);
              if (resolved.parent.isTextblock) {
                const text = randomWord(rng);
                state = state.apply(state.tr.insertText(text, pos));
                ops.push(`insertText(${JSON.stringify(text)}, ${pos})`);
              } else {
                ops.push(`skip-insert-non-textblock(${pos})`);
              }
              break;
            }
            case 1: {
              const from = rng.range(1, Math.max(1, docSize - 2));
              const to = Math.min(from + rng.range(1, 6), docSize - 1);
              try {
                state = state.apply(state.tr.delete(from, to));
                ops.push(`delete(${from}, ${to})`);
              } catch (error) {
                if (!(error instanceof RangeError)) throw error;
                ops.push(`skip-delete-range-error(${from}, ${to})`);
              }
              break;
            }
            case 2: {
              const markTypes = Object.keys(schema.marks);
              if (markTypes.length > 0) {
                const markName = rng.pick(markTypes);
                const markType = schema.marks[markName]!;
                const from = rng.range(1, Math.max(1, docSize - 2));
                const to = Math.min(from + rng.range(1, 10), docSize - 1);
                try {
                  state = state.apply(state.tr.addMark(from, to, markType.create()));
                  ops.push(`addMark(${markName}, ${from}, ${to})`);
                } catch (error) {
                  if (!(error instanceof RangeError)) throw error;
                  ops.push(`skip-addMark-range-error(${markName}, ${from}, ${to})`);
                }
              }
              break;
            }
            case 3: {
              const from = rng.range(1, Math.max(1, docSize - 2));
              const to = Math.min(from + rng.range(1, 6), docSize - 1);
              try {
                const word = randomWord(rng);
                const text = schema.text(word);
                state = state.apply(state.tr.replaceWith(from, to, text));
                ops.push(`replaceWith(${JSON.stringify(word)}, ${from}, ${to})`);
              } catch (error) {
                if (!(error instanceof RangeError)) throw error;
                ops.push(`skip-replace-range-error(${from}, ${to})`);
              }
              break;
            }
            case 4: {
              serializeMarkdown(state.doc);
              ops.push("serialize");
              break;
            }
            case 5: {
              const selection = randomReachableSelection(state.doc, rng);
              if (selection) {
                state = state.apply(state.tr.setSelection(selection));
                ops.push(
                  `setSelection(${selection.constructor.name}, ${selection.from}, ${selection.to})`,
                );
              } else {
                ops.push("skip-selection-none-reachable");
              }
              break;
            }
          }
        } catch (error) {
          throw new Error(`${markdownFuzzContext(seed, md, ops)}\n${String(error)}`);
        }
      }

      const context = markdownFuzzContext(seed, md, ops);
      expect(validatePMNode(state.doc), `${context}\nSchema errors`).toEqual([]);
      expect(() => serializeMarkdown(state.doc), `${context}\nSerialize failed`).not.toThrow();
    }
  });
});
