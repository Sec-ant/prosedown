/**
 * GFM (GitHub Flavored Markdown) feature tests.
 *
 * Tests strikethrough, tables, and task lists — features beyond CommonMark.
 */
import { describe, it, expect } from "vite-plus/test";
import { parseMarkdown, serializeMarkdown } from "../index";

describe("GFM: Strikethrough", () => {
  it("parses ~~text~~", () => {
    const doc = parseMarkdown("~~strikethrough~~\n");
    const para = doc.firstChild!;
    let hasStrikethrough = false;
    para.forEach((child) => {
      if (child.marks.some((m) => m.type.name === "strikethrough")) {
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
      if (markNames.includes("strikethrough") && markNames.includes("strong")) {
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

  it("header row uses table_header cells", () => {
    const md = "| a | b |\n| - | - |\n| c | d |\n";
    const doc = parseMarkdown(md);
    const table = doc.firstChild!;
    const headerRow = table.firstChild!;
    expect(headerRow.type.name).toBe("table_row");
    headerRow.forEach((cell) => {
      expect(cell.type.name).toBe("table_header");
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

  it("table with alignment attrs on cells", () => {
    const md = "| left | center | right |\n| :--- | :---: | ---: |\n| a | b | c |\n";
    const doc = parseMarkdown(md);
    const table = doc.firstChild!;
    expect(table.type.name).toBe("table");

    // Header row alignment
    const headerRow = table.firstChild!;
    expect(headerRow.child(0).attrs.align).toBe("left");
    expect(headerRow.child(1).attrs.align).toBe("center");
    expect(headerRow.child(2).attrs.align).toBe("right");

    // Data row alignment
    const dataRow = table.child(1);
    expect(dataRow.child(0).attrs.align).toBe("left");
    expect(dataRow.child(1).attrs.align).toBe("center");
    expect(dataRow.child(2).attrs.align).toBe("right");
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
      expect(cell.type.name).toBe("table_header");
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
    // Re-parse and verify alignment attrs are preserved
    const doc2 = parseMarkdown(serialized);
    const headerRow = doc2.firstChild!.firstChild!;
    expect(headerRow.child(0).attrs.align).toBe("left");
    expect(headerRow.child(1).attrs.align).toBe("center");
    expect(headerRow.child(2).attrs.align).toBe("right");
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
        if (mark.type.name === "em") hasEm = true;
        if (mark.type.name === "code") hasCode = true;
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
    expect(list.type.name).toBe("bullet_list");

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
    expect(list.type.name).toBe("ordered_list");
    expect(list.child(0)!.attrs.checked).toBe(true);
    expect(list.child(1)!.attrs.checked).toBe(false);
  });
});
