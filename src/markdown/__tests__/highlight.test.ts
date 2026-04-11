/**
 * Highlight mark (`==text==`) tests.
 *
 * Tests basic parsing, roundtrip, and mark combinations.
 * CJK-friendly flanking tests live in cjk.test.ts alongside other CJK tests.
 */
import { describe, it, expect } from "vite-plus/test";
import { parseMarkdown, serializeMarkdown } from "../index";

function hasMarkInParagraph(md: string, markName: string): boolean {
  const doc = parseMarkdown(md);
  const para = doc.firstChild!;
  let found = false;
  para.forEach((child) => {
    if (child.marks.some((m) => m.type.name === markName)) found = true;
  });
  return found;
}

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
