/**
 * CJK-friendly tests.
 *
 * Tests that emphasis and strikethrough work correctly with CJK characters,
 * thanks to remark-cjk-friendly and remark-cjk-friendly-gfm-strikethrough.
 *
 * Without these plugins, emphasis markers adjacent to CJK characters fail
 * because micromark's default flanking rules require non-Unicode-punctuation
 * neighbors.
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

describe("CJK: Emphasis with Chinese characters", () => {
  it("emphasis around Chinese text: *中文*", () => {
    expect(hasMarkInParagraph("*中文*\n", "em")).toBe(true);
  });

  it("emphasis around Chinese text: _中文_", () => {
    expect(hasMarkInParagraph("_中文_\n", "em")).toBe(true);
  });

  it("strong around Chinese text: **中文**", () => {
    expect(hasMarkInParagraph("**中文**\n", "strong")).toBe(true);
  });

  it("strong around Chinese text: __中文__", () => {
    expect(hasMarkInParagraph("__中文__\n", "strong")).toBe(true);
  });

  it("emphasis adjacent to Chinese: 这是*重要*的内容", () => {
    expect(hasMarkInParagraph("这是*重要*的内容\n", "em")).toBe(true);
  });

  it("strong adjacent to Chinese: 这是**重要**的内容", () => {
    expect(hasMarkInParagraph("这是**重要**的内容\n", "strong")).toBe(true);
  });

  it("mixed Chinese and English with emphasis", () => {
    const doc = parseMarkdown("Hello *世界* world\n");
    let hasEm = false;
    let emText = "";
    doc.descendants((node) => {
      if (node.marks.some((m) => m.type.name === "em")) {
        hasEm = true;
        emText = node.text ?? "";
      }
    });
    expect(hasEm).toBe(true);
    expect(emText).toBe("世界");
  });
});

describe("CJK: Emphasis with Japanese characters", () => {
  it("emphasis around Japanese: *日本語*", () => {
    expect(hasMarkInParagraph("*日本語*\n", "em")).toBe(true);
  });

  it("emphasis with hiragana: *こんにちは*", () => {
    expect(hasMarkInParagraph("*こんにちは*\n", "em")).toBe(true);
  });

  it("emphasis with katakana: *カタカナ*", () => {
    expect(hasMarkInParagraph("*カタカナ*\n", "em")).toBe(true);
  });

  it("strong with Japanese: **日本語**", () => {
    expect(hasMarkInParagraph("**日本語**\n", "strong")).toBe(true);
  });
});

describe("CJK: Emphasis with Korean characters", () => {
  it("emphasis around Korean: *한국어*", () => {
    expect(hasMarkInParagraph("*한국어*\n", "em")).toBe(true);
  });

  it("strong with Korean: **한국어**", () => {
    expect(hasMarkInParagraph("**한국어**\n", "strong")).toBe(true);
  });
});

describe("CJK: Strikethrough with CJK characters", () => {
  it("strikethrough around Chinese: ~~删除~~", () => {
    expect(hasMarkInParagraph("~~删除~~\n", "strikethrough")).toBe(true);
  });

  it("strikethrough adjacent to Chinese: 这是~~删除的~~文本", () => {
    expect(hasMarkInParagraph("这是~~删除的~~文本\n", "strikethrough")).toBe(true);
  });

  it("strikethrough with Japanese: ~~取り消し~~", () => {
    expect(hasMarkInParagraph("~~取り消し~~\n", "strikethrough")).toBe(true);
  });

  it("strikethrough with Korean: ~~취소선~~", () => {
    expect(hasMarkInParagraph("~~취소선~~\n", "strikethrough")).toBe(true);
  });
});

describe("CJK: Roundtrip", () => {
  it("Chinese paragraph roundtrips", () => {
    const md = "这是一段中文文本。\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });

  it("Chinese with marks roundtrips", () => {
    const md = "这是**粗体**和*斜体*和`代码`。\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });

  it("Chinese heading roundtrips", () => {
    const md = "# 标题\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });

  it("Chinese list roundtrips", () => {
    const md = "- 第一项\n- 第二项\n- 第三项\n";
    const doc1 = parseMarkdown(md);
    const serialized = serializeMarkdown(doc1);
    const doc2 = parseMarkdown(serialized);
    expect(doc2.toJSON()).toEqual(doc1.toJSON());
  });

  it("Chinese blockquote roundtrips", () => {
    const md = "> 引用中文文本。\n";
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

describe("CJK: Full-width punctuation", () => {
  it("emphasis next to Chinese punctuation", () => {
    // CJK punctuation should not prevent emphasis from working
    const doc = parseMarkdown("「*重要*」\n");
    let hasEm = false;
    doc.descendants((node) => {
      if (node.marks.some((m) => m.type.name === "em")) hasEm = true;
    });
    expect(hasEm).toBe(true);
  });

  it("strong next to Chinese punctuation", () => {
    const doc = parseMarkdown("（**注意**）\n");
    let hasStrong = false;
    doc.descendants((node) => {
      if (node.marks.some((m) => m.type.name === "strong")) hasStrong = true;
    });
    expect(hasStrong).toBe(true);
  });
});
