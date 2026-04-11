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
