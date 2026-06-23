import { describe, it, expect } from "vite-plus/test";
import { GapCursor } from "prosemirror-gapcursor";
import type { Node as PMNode, ResolvedPos } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { blockquoteExt } from "../src/markdown/extensions/blockquote";
import { breakExt } from "../src/markdown/extensions/break";
import { codeExt } from "../src/markdown/extensions/code";
import { insertTable, tableExt } from "../src/markdown/extensions/table";
import { parseMarkdown, schema, serializeMarkdown } from "../src/markdown";

const GC = GapCursor as unknown as {
  valid: (pos: ResolvedPos) => boolean;
  findGapCursorFrom?: (pos: ResolvedPos, dir: number, mustMove?: boolean) => ResolvedPos | null;
};

function createState(markdown: string): EditorState {
  return EditorState.create({ doc: parseMarkdown(markdown), schema });
}

function createStateFromDoc(doc: PMNode): EditorState {
  return EditorState.create({ doc, schema });
}

function setTextSelection(state: EditorState, from: number, to = from): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function applyCommand(
  state: EditorState,
  command: Command,
): { handled: boolean; state: EditorState } {
  let nextState = state;
  const handled = command(state, (tr) => {
    nextState = nextState.apply(tr);
  });
  return { handled, state: nextState };
}

function paragraph(text = ""): PMNode {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}

function emptyParagraphPosition(doc: PMNode): number {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found == null && node.type.name === "paragraph" && node.content.size === 0) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  if (found == null) throw new Error("empty paragraph not found");
  return found;
}

function tableCellPosition(doc: PMNode, rowIndex: number, cellIndex: number): number {
  let found: number | null = null;
  let currentRow = -1;

  doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name === "table_row") currentRow += 1;
    if (node.type.name === "table_cell" && currentRow === rowIndex) {
      if (cellIndex === 0) {
        found = pos + 1;
        return false;
      }
      cellIndex -= 1;
    }
    return found == null;
  });

  if (found == null) throw new Error(`table cell ${rowIndex}:${cellIndex} not found`);
  return found;
}

function topLevelTypes(doc: PMNode): string[] {
  const types: string[] = [];
  doc.forEach((node) => types.push(node.type.name));
  return types;
}

describe("Editor contract: code block commands", () => {
  const commands = codeExt.keymap!(schema);

  it("Tab inserts two spaces inside a code block", () => {
    let state = createState("```js\nx\n```\n");
    state = setTextSelection(state, 1);

    const result = applyCommand(state, commands.Tab!);

    expect(result.handled).toBe(true);
    expect(result.state.doc.firstChild!.textContent).toBe("  x");
  });

  it("Shift-Tab removes up to two leading spaces from the current code line", () => {
    let state = createState("```js\n  x\n```\n");
    state = setTextSelection(state, 3);

    const result = applyCommand(state, commands["Shift-Tab"]!);

    expect(result.handled).toBe(true);
    expect(result.state.doc.firstChild!.textContent).toBe("x");
  });

  it("Mod-Enter exits a code block into a following paragraph", () => {
    let state = createState("```js\nx\n```\n");
    state = setTextSelection(state, 2);

    const result = applyCommand(state, commands["Mod-Enter"]!);

    expect(result.handled).toBe(true);
    expect(topLevelTypes(result.state.doc)).toEqual(["code", "paragraph"]);
    expect(result.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("Enter converts a typed code fence paragraph into a code block", () => {
    const doc = schema.nodes.doc.create(null, [paragraph("```ts")]);
    let state = createStateFromDoc(doc);
    state = setTextSelection(state, 6);

    const result = applyCommand(state, commands.Enter!);

    expect(result.handled).toBe(true);
    expect(result.state.doc.firstChild!.type.name).toBe("code");
    expect(result.state.doc.firstChild!.attrs.lang).toBe("ts");
  });
});

describe("Editor contract: blockquote exits", () => {
  const commands = blockquoteExt.keymap!(schema);

  it("Enter exits a trailing empty paragraph from a blockquote", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.blockquote.create(null, [paragraph("quoted"), paragraph()]),
    ]);
    let state = createStateFromDoc(doc);
    state = setTextSelection(state, emptyParagraphPosition(state.doc));

    const result = applyCommand(state, commands.Enter!);

    expect(result.handled).toBe(true);
    expect(topLevelTypes(result.state.doc)).toEqual(["blockquote", "paragraph"]);
  });

  it("Backspace converts a single empty blockquote into a paragraph", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.blockquote.create(null, [paragraph()]),
    ]);
    let state = createStateFromDoc(doc);
    state = setTextSelection(state, emptyParagraphPosition(state.doc));

    const result = applyCommand(state, commands.Backspace!);

    expect(result.handled).toBe(true);
    expect(topLevelTypes(result.state.doc)).toEqual(["paragraph"]);
  });
});

describe("Editor contract: table commands", () => {
  const commands = tableExt.keymap!(schema);

  it("insertTable creates a 3x2 table and selects the first cell", () => {
    let state = createState("before\n");
    state = setTextSelection(state, 1);

    const result = applyCommand(state, insertTable);
    const table = result.state.doc.child(1);

    expect(result.handled).toBe(true);
    expect(topLevelTypes(result.state.doc)).toEqual(["paragraph", "table"]);
    expect(table.childCount).toBe(2);
    table.forEach((row) => expect(row.childCount).toBe(3));
    expect(result.state.selection.$from.parent.type.name).toBe("table_cell");
  });

  it("Tab moves from the first cell to the next cell", () => {
    let state = createState("| A | B |\n|---|---|\n| 1 | 2 |\n");
    state = setTextSelection(state, tableCellPosition(state.doc, 0, 0));

    const result = applyCommand(state, commands.Tab!);

    expect(result.handled).toBe(true);
    expect(result.state.selection.$from.parent.type.name).toBe("table_cell");
    expect(result.state.selection.$from.parent.textContent).toBe("B");
  });

  it("Tab in the last cell creates a new row", () => {
    let state = createState("| A | B |\n|---|---|\n| 1 | 2 |\n");
    state = setTextSelection(state, tableCellPosition(state.doc, 1, 1) + 1);

    const result = applyCommand(state, commands.Tab!);

    expect(result.handled).toBe(true);
    expect(result.state.doc.firstChild!.childCount).toBe(3);
    expect(result.state.selection.$from.parent.type.name).toBe("table_cell");
  });

  it("Enter in the last row exits the table", () => {
    let state = createState("| A | B |\n|---|---|\n| 1 | 2 |\n");
    state = setTextSelection(state, tableCellPosition(state.doc, 1, 0));

    const result = applyCommand(state, commands.Enter!);

    expect(result.handled).toBe(true);
    expect(topLevelTypes(result.state.doc)).toEqual(["table", "paragraph"]);
    expect(result.state.selection.$from.parent.type.name).toBe("paragraph");
  });
});

describe("Editor contract: gap cursor positions", () => {
  it("is valid between non-textblock blocks", () => {
    const doc = parseMarkdown("> quoted\n\n```ts\ncode\n```\n");
    const gapPos = doc.child(0).nodeSize;

    expect(GC.valid(doc.resolve(gapPos))).toBe(true);
  });

  it("is not valid between two paragraphs", () => {
    const doc = parseMarkdown("one\n\ntwo\n");
    const gapPos = doc.child(0).nodeSize;

    expect(GC.valid(doc.resolve(gapPos))).toBe(false);
  });

  it("finds a gap cursor when searching from a nearby block boundary", () => {
    const doc = parseMarkdown("> quoted\n\n```ts\ncode\n```\n");
    const afterBlockquote = doc.child(0).nodeSize;

    expect(GC.findGapCursorFrom?.(doc.resolve(afterBlockquote), 1, false)?.pos).toBe(
      afterBlockquote,
    );
  });
});

describe("Editor contract: hard break command", () => {
  it("Shift-Enter inserts a hard break in a paragraph", () => {
    let state = createState("hello world\n");
    state = setTextSelection(state, 6);

    const result = applyCommand(state, breakExt.keymap!(schema)["Shift-Enter"]!);

    expect(result.handled).toBe(true);
    expect(
      result.state.doc.firstChild!.content.content.some((child) => child.type.name === "break"),
    ).toBe(true);
    expect(serializeMarkdown(result.state.doc)).toContain("\\\n");
  });
});
