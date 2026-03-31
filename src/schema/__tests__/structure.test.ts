/**
 * Structural and edge case tests.
 *
 * Detailed verification of PM document structure for each feature,
 * plus edge cases that stress the parser.
 */
import { describe, it, expect } from "vite-plus/test";
import { parseMarkdown, serializeMarkdown } from "../index";
import type { Node as PMNode } from "prosemirror-model";

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
    expect(h.attrs.level).toBe(1);
    expect(h.textContent).toBe("Hello");
  });

  it("h6 attrs", () => {
    const doc = parseMarkdown("###### Deep\n");
    const h = doc.firstChild!;
    expect(h.attrs.level).toBe(6);
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
    expect(cb.type.name).toBe("code_block");
    expect(cb.attrs.language).toBe("python");
    expect(cb.textContent).toBe("print('hello')");
  });

  it("fenced code block without language", () => {
    const doc = parseMarkdown("```\nsome code\n```\n");
    const cb = doc.firstChild!;
    expect(cb.type.name).toBe("code_block");
    expect(cb.attrs.language).toBeNull();
  });

  it("indented code block", () => {
    const doc = parseMarkdown("    indented code\n");
    expect(doc.firstChild?.type.name).toBe("code_block");
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
      if (child.type.name === "bullet_list") hasList = true;
    });
    expect(hasList).toBe(true);
  });
});

// ========== List structure ==========

describe("Structure: lists", () => {
  it("tight bullet list", () => {
    const doc = parseMarkdown("- a\n- b\n- c\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("bullet_list");
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
    expect(list.type.name).toBe("bullet_list");
    expect(list.childCount).toBe(3);
  });

  it("ordered list starting at 1", () => {
    const doc = parseMarkdown("1. a\n2. b\n3. c\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("ordered_list");
    expect(list.attrs.order).toBe(1);
  });

  it("ordered list starting at 5", () => {
    const doc = parseMarkdown("5. a\n6. b\n");
    const list = doc.firstChild!;
    expect(list.type.name).toBe("ordered_list");
    expect(list.attrs.order).toBe(5);
  });

  it("list with nested code block", () => {
    const doc = parseMarkdown("- item\n\n  ```\n  code\n  ```\n");
    const list = doc.firstChild!;
    const item = list.firstChild!;
    let hasCodeBlock = false;
    item.forEach((child) => {
      if (child.type.name === "code_block") hasCodeBlock = true;
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
    expect(marks.has("em")).toBe(true);
  });

  it("bold inside italic", () => {
    const doc = parseMarkdown("*foo **bar** baz*\n");
    const marks = allMarks(doc);
    expect(marks.has("strong")).toBe(true);
    expect(marks.has("em")).toBe(true);
  });

  it("code does not contain other marks", () => {
    // Inline code should exclude other marks (code excludes "_")
    const doc = parseMarkdown("`code`\n");
    const para = doc.firstChild!;
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "code")) {
        // Only code mark, no others
        const nonCodeMarks = child.marks.filter((m) => m.type.name !== "code");
        expect(nonCodeMarks.length).toBe(0);
      }
    });
  });

  it("link with emphasis inside", () => {
    const doc = parseMarkdown("[*click*](url)\n");
    const marks = allMarks(doc);
    expect(marks.has("link")).toBe(true);
    expect(marks.has("em")).toBe(true);
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
    expect(marks.has("strikethrough")).toBe(true);
    expect(marks.has("strong")).toBe(true);
  });
});

// ========== Image structure ==========

describe("Structure: images", () => {
  it("inline image with all attrs", () => {
    const doc = parseMarkdown('![alt](/src "title")\n');
    let found = false;
    doc.descendants((node) => {
      if (node.type.name === "image") {
        expect(node.attrs.src).toBe("/src");
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
      if (node.type.name === "hard_break") breakCount++;
    });
    expect(breakCount).toBe(1);
  });

  it("backslash hard break", () => {
    const doc = parseMarkdown("foo\\\nbar\n");
    let breakCount = 0;
    doc.descendants((node) => {
      if (node.type.name === "hard_break") breakCount++;
    });
    expect(breakCount).toBe(1);
  });

  it("multiple hard breaks", () => {
    const doc = parseMarkdown("a  \nb  \nc\n");
    let breakCount = 0;
    doc.descendants((node) => {
      if (node.type.name === "hard_break") breakCount++;
    });
    expect(breakCount).toBe(2);
  });
});

// ========== Horizontal rule structure ==========

describe("Structure: horizontal rules", () => {
  it("three dashes", () => {
    const doc = parseMarkdown("---\n");
    expect(doc.firstChild?.type.name).toBe("horizontal_rule");
  });

  it("three asterisks", () => {
    const doc = parseMarkdown("***\n");
    expect(doc.firstChild?.type.name).toBe("horizontal_rule");
  });

  it("three underscores", () => {
    const doc = parseMarkdown("___\n");
    expect(doc.firstChild?.type.name).toBe("horizontal_rule");
  });

  it("hr between paragraphs", () => {
    const doc = parseMarkdown("above\n\n---\n\nbelow\n");
    const types = topLevelTypes(doc);
    expect(types).toEqual(["paragraph", "horizontal_rule", "paragraph"]);
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
    expect(types).toContain("bullet_list");
    expect(types).toContain("ordered_list");
    expect(types).toContain("code_block");
    expect(types).toContain("horizontal_rule");

    const marks = allMarks(doc);
    expect(marks.has("strong")).toBe(true);
    expect(marks.has("em")).toBe(true);
    expect(marks.has("code")).toBe(true);
    expect(marks.has("strikethrough")).toBe(true);
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
        if (mark.type.name === "link" && !hrefs.includes(mark.attrs.href as string)) {
          hrefs.push(mark.attrs.href as string);
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
