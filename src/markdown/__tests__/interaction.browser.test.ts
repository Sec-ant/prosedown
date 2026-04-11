/**
 * Browser-mode interaction tests.
 *
 * These tests exercise the full editor stack inside a real browser instead of
 * jsdom, so selections, layout-dependent behavior, and ProseMirror view logic
 * run against actual browser primitives.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { GapCursor } from "prosemirror-gapcursor";
import { createParagraphNear } from "prosemirror-commands";
import { createPastePlugin } from "../../editor/plugins/paste-link";
import { schema, parseMarkdown, serializeMarkdown } from "../index";
import { codeExt as codeBlockExt } from "../extensions/code";
import { blockquoteExt } from "../extensions/blockquote";
import { breakExt as hardBreakExt } from "../extensions/break";
import { tableExt } from "../extensions/table";
import { linkExt } from "../extensions/link";
import type { Node as PMNode } from "prosemirror-model";
import { DOMParser as PMDOMParser, Slice } from "prosemirror-model";
import { toggleMark, setBlockType } from "prosemirror-commands";
import { wrapInList, sinkListItem, splitListItem } from "prosemirror-schema-list";
import {
  createEditor,
  createEditorState,
  createReactEditor,
  destroyEditor,
  fireComposition,
  flushBrowserUpdates,
  GC,
  getViewInputState,
  topLevelTypes,
  type MountedReactEditor,
} from "./browser-helpers";

// ========== Test Helpers ==========

/**
 * Simulate typing text into the editor, character by character.
 *
 * For each character, we first try to invoke `handleTextInput` (which is how
 * ProseMirror input rules fire). If no plugin handles it, we insert the
 * character via a transaction.
 */
function typeText(view: EditorView, text: string): void {
  for (const char of text) {
    const { from, to } = view.state.selection;
    // Try all handleTextInput props (input rules, etc.)
    // someProp("handleTextInput") expects 5-arg callback: (view, from, to, text, deflt)
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, char, () => view.state.tr),
    );
    if (!handled) {
      view.dispatch(view.state.tr.insertText(char, from, to));
    }
  }
}

/** Select a text range in the editor. */
function selectRange(view: EditorView, from: number, to: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

/** Move cursor to a position. */
function setCursor(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

function setNodeSelection(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
}

/** Run a ProseMirror command against the view. */
function runCommand(
  view: EditorView,
  command: (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean,
): boolean {
  return command(view.state, view.dispatch.bind(view), view);
}

/** Get first child of the document. */
function firstChild(view: EditorView): PMNode {
  return view.state.doc.firstChild!;
}

/** Collect all mark names in a document. */
function collectMarks(doc: PMNode): Set<string> {
  const marks = new Set<string>();
  doc.descendants((node) => {
    for (const m of node.marks) marks.add(m.type.name);
  });
  return marks;
}

/** Find cursor's enclosing table cell info. */
function findCellInfo(v: EditorView) {
  const { $from } = v.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "table_cell") {
      return {
        cellDepth: d,
        cellType: node.type.name,
        cellText: node.textContent,
        cellIdx: $from.index(d - 1), // cell position within row
        rowIdx: $from.index(d - 2), // row position within table
        rowDepth: d - 1,
      };
    }
  }
  return null;
}

/** Get the code block keymap commands from the extension. */
function getCodeBlockCommands() {
  return codeBlockExt.keymap!(schema) as {
    Enter: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
    Tab: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
    "Shift-Tab": (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
    "Mod-Enter": (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
    ArrowDown: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
    Backspace: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
  };
}

/** Get the table keymap commands from the extension. */
function getTableCommands() {
  return tableExt.keymap!(schema) as {
    Enter: (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;
    Tab: (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;
    "Shift-Tab": (
      state: EditorState,
      dispatch?: (tr: Transaction) => void,
      view?: EditorView,
    ) => boolean;
    Backspace: (
      state: EditorState,
      dispatch?: (tr: Transaction) => void,
      view?: EditorView,
    ) => boolean;
    Delete: (
      state: EditorState,
      dispatch?: (tr: Transaction) => void,
      view?: EditorView,
    ) => boolean;
    ArrowUp: (
      state: EditorState,
      dispatch?: (tr: Transaction) => void,
      view?: EditorView,
    ) => boolean;
    ArrowDown: (
      state: EditorState,
      dispatch?: (tr: Transaction) => void,
      view?: EditorView,
    ) => boolean;
  };
}

type DraggingView = EditorView & {
  dragging: {
    move: boolean;
    node?: NodeSelection;
  } | null;
  input: {
    mouseDown: {
      mightDrag: {
        node: PMNode;
        pos: number;
      } | null;
    } | null;
  };
};

function centerOf(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

// ========== Input Rule Regex Tests (pure unit tests, no DOM) ==========

describe("Input rule regexes", () => {
  describe("heading", () => {
    const re = /^(#{1,6})\s$/;
    it("matches # + space", () => expect(re.test("# ")).toBe(true));
    it("matches ## + space", () => expect(re.test("## ")).toBe(true));
    it("matches ###### + space", () => expect(re.test("###### ")).toBe(true));
    it("rejects ####### + space (7 hashes)", () => expect(re.test("####### ")).toBe(false));
    it("rejects # without space", () => expect(re.test("#")).toBe(false));
    it("captures hash count", () => expect("### ".match(re)![1]!.length).toBe(3));
  });

  describe("blockquote", () => {
    const re = /^\s{0,3}>\s$/;
    it("matches > + space", () => expect(re.test("> ")).toBe(true));
    it("matches with leading spaces", () => expect(re.test("   > ")).toBe(true));
    it("rejects 4+ leading spaces", () => expect(re.test("    > ")).toBe(false));
  });

  describe("code block", () => {
    const re = /^```([a-zA-Z]*)$/;
    it("matches bare ```", () => expect(re.test("```")).toBe(true));
    it("matches ```js", () => expect(re.test("```js")).toBe(true));
    it("matches ```typescript", () => expect(re.test("```typescript")).toBe(true));
    it("captures language", () => expect("```python".match(re)![1]).toBe("python"));
    it("captures empty language for bare", () => expect("```".match(re)![1]).toBe(""));
  });

  describe("horizontal rule", () => {
    const re = /^([-*_])\1{2,}$/;
    it("matches ---", () => expect(re.test("---")).toBe(true));
    it("matches ***", () => expect(re.test("***")).toBe(true));
    it("matches ___", () => expect(re.test("___")).toBe(true));
    it("matches -----", () => expect(re.test("-----")).toBe(true));
    it("rejects --", () => expect(re.test("--")).toBe(false));
    it("rejects mixed -_-", () => expect(re.test("-_-")).toBe(false));
  });

  describe("bullet list", () => {
    const re = /^\s{0,3}[-*+]\s$/;
    it("matches - space", () => expect(re.test("- ")).toBe(true));
    it("matches * space", () => expect(re.test("* ")).toBe(true));
    it("matches + space", () => expect(re.test("+ ")).toBe(true));
    it("rejects without space", () => expect(re.test("-")).toBe(false));
  });

  describe("ordered list", () => {
    const re = /^\s{0,3}(\d+)\.\s$/;
    it("matches 1. space", () => expect(re.test("1. ")).toBe(true));
    it("matches 99. space", () => expect(re.test("99. ")).toBe(true));
    it("captures start number", () => expect("3. ".match(re)![1]).toBe("3"));
    it("rejects 1.without space", () => expect(re.test("1.")).toBe(false));
  });

  describe("strong", () => {
    const reAsterisk = /\*\*([^\s](?:.*[^\s])?)\*\*(.)$/;
    const reUnderscore = /__([^\s](?:.*[^\s])?)__(.)$/;

    it("matches **text** + trailing char", () => {
      const m = "**bold** ".match(reAsterisk);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("bold");
      expect(m![2]).toBe(" ");
    });

    it("matches __text__ + trailing char", () => {
      const m = "__bold__ ".match(reUnderscore);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("bold");
    });

    it("rejects ** ** (whitespace inner)", () => {
      expect(reAsterisk.test("** ** ")).toBe(false);
    });

    it("matches multi-word **some bold text** + char", () => {
      const m = "**some bold text** ".match(reAsterisk);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("some bold text");
    });
  });

  describe("emphasis", () => {
    const reAsterisk = /(?<!\*)\*([^\s*](?:.*[^\s*])?)\*(.)$/;
    const reUnderscore = /(?<!_)_([^\s_](?:.*[^\s_])?)_(.)$/;

    it("matches *text* + trailing char", () => {
      const m = "*italic* ".match(reAsterisk);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("italic");
      expect(m![2]).toBe(" ");
    });

    it("does NOT match inside **bold**", () => {
      // The lookbehind (?<!\*) should prevent matching *bold** where the opening
      // * is preceded by another *
      expect("**bold**".match(reAsterisk)).toBeNull();
    });

    it("matches _text_ + trailing char", () => {
      const m = "_italic_ ".match(reUnderscore);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("italic");
    });

    it("does NOT match inside __bold__", () => {
      expect("__bold__".match(reUnderscore)).toBeNull();
    });
  });

  describe("inline code", () => {
    const re = /`([^\s`](?:.*[^\s`])?)`(.)$/;
    it("matches `code` + trailing char", () => {
      const m = "`code` ".match(re);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("code");
    });

    it("rejects ` ` (whitespace only)", () => {
      expect(re.test("` ` ")).toBe(false);
    });
  });

  describe("delete", () => {
    const re = /~~([^\s](?:.*[^\s])?)~~(.)$/;
    it("matches ~~text~~ + trailing char", () => {
      const m = "~~strike~~ ".match(re);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("strike");
    });

    it("rejects ~~ ~~ (whitespace inner)", () => {
      expect(re.test("~~ ~~ ")).toBe(false);
    });
  });
});

// ========== Drag and Drop ==========

describe("Drag and drop", () => {
  let mounted: MountedReactEditor | null = null;

  afterEach(() => {
    mounted?.destroy();
    mounted = null;
  });

  it("direct image drag starts as an internal move", async () => {
    mounted = await createReactEditor("before ![alt](image.png) after\n\nbelow\n");
    const view = mounted.getView() as DraggingView;
    const img = view.dom.querySelector("img");

    expect(img).toBeInstanceOf(HTMLImageElement);
    const image = img as HTMLImageElement;
    image.style.width = "40px";
    image.style.height = "20px";
    expect(image.draggable).toBe(true);

    const { x, y } = centerOf(image);
    image.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );

    expect(view.input.mouseDown?.mightDrag?.node.type.name).toBe("image");

    const dataTransfer = new DataTransfer();
    image.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer,
      }),
    );

    expect(view.dragging?.move).toBe(true);
    expect(view.dragging?.node?.node.type.name).toBe("image");

    const paragraphs = view.dom.querySelectorAll("p");
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    const dropTarget = paragraphs[1] as HTMLElement;
    const drop = centerOf(dropTarget);
    dropTarget.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: drop.x,
        clientY: drop.y,
        dataTransfer,
      }),
    );

    let imageCount = 0;
    view.state.doc.descendants((node) => {
      if (node.type.name === "image") imageCount++;
    });
    expect(imageCount).toBe(1);
  });
});

// ========== Input Rule Transformation Tests ==========

describe("Input rule transformations", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  describe("block-level input rules", () => {
    it("# + space converts paragraph to h1", () => {
      view = createEditor("");
      typeText(view, "# ");
      expect(firstChild(view).type.name).toBe("heading");
      expect(firstChild(view).attrs.depth).toBe(1);
    });

    it("## + space converts paragraph to h2", () => {
      view = createEditor("");
      typeText(view, "## ");
      expect(firstChild(view).type.name).toBe("heading");
      expect(firstChild(view).attrs.depth).toBe(2);
    });

    it("###### + space converts paragraph to h6", () => {
      view = createEditor("");
      typeText(view, "###### ");
      expect(firstChild(view).type.name).toBe("heading");
      expect(firstChild(view).attrs.depth).toBe(6);
    });

    it("####### + space does NOT create heading (7 hashes)", () => {
      view = createEditor("");
      typeText(view, "####### ");
      expect(firstChild(view).type.name).toBe("paragraph");
    });

    it("heading input rule preserves text typed after trigger", () => {
      view = createEditor("");
      typeText(view, "## Hello World");
      expect(firstChild(view).type.name).toBe("heading");
      expect(firstChild(view).attrs.depth).toBe(2);
      expect(firstChild(view).textContent).toBe("Hello World");
    });

    it("> + space wraps in blockquote", () => {
      view = createEditor("");
      typeText(view, "> ");
      expect(firstChild(view).type.name).toBe("blockquote");
    });

    it("```js + Enter converts to code block with language", () => {
      view = createEditor("");
      typeText(view, "```js");
      runCommand(view, getCodeBlockCommands().Enter);
      const first = firstChild(view);
      expect(first.type.name).toBe("code");
      expect(first.attrs.lang).toBe("js");
    });

    it("bare ``` + Enter converts to code block with no language", () => {
      view = createEditor("");
      typeText(view, "```");
      runCommand(view, getCodeBlockCommands().Enter);
      expect(firstChild(view).type.name).toBe("code");
      expect(firstChild(view).attrs.lang).toBeNull();
    });

    it("--- inserts horizontal rule", () => {
      view = createEditor("");
      typeText(view, "---");
      const types = topLevelTypes(view.state.doc);
      expect(types).toContain("thematic_break");
    });

    it("*** inserts horizontal rule", () => {
      view = createEditor("");
      typeText(view, "***");
      const types = topLevelTypes(view.state.doc);
      expect(types).toContain("thematic_break");
    });

    it("- + space wraps in bullet list", () => {
      view = createEditor("");
      typeText(view, "- ");
      expect(firstChild(view).type.name).toBe("list");
    });

    it("* + space wraps in bullet list", () => {
      view = createEditor("");
      typeText(view, "* ");
      expect(firstChild(view).type.name).toBe("list");
    });

    it("1. + space wraps in ordered list", () => {
      view = createEditor("");
      typeText(view, "1. ");
      expect(firstChild(view).type.name).toBe("list");
    });

    it("3. + space wraps in ordered list starting at 3", () => {
      view = createEditor("");
      typeText(view, "3. ");
      const first = firstChild(view);
      expect(first.type.name).toBe("list");
      expect(first.attrs.start).toBe(3);
    });
  });

  describe("inline mark input rules", () => {
    it("**bold** + space creates strong mark", () => {
      view = createEditor("");
      typeText(view, "**bold** ");
      expect(collectMarks(view.state.doc).has("strong")).toBe(true);
    });

    it("**bold** does NOT prematurely trigger emphasis", () => {
      view = createEditor("");
      typeText(view, "**bold** ");
      const marks = collectMarks(view.state.doc);
      expect(marks.has("strong")).toBe(true);
      expect(marks.has("emphasis")).toBe(false);
    });

    it("**bold** + space works at the start of a complex document", () => {
      view = createEditor("intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- item\n\n---\n");
      setCursor(view, 1);
      expect(() => typeText(view, "**bold** ")).not.toThrow();
      expect(collectMarks(view.state.doc).has("strong")).toBe(true);
    });

    it("*italic* + space creates em mark", () => {
      view = createEditor("");
      typeText(view, "*italic* ");
      expect(collectMarks(view.state.doc).has("emphasis")).toBe(true);
    });

    it("`code` + space creates code mark", () => {
      view = createEditor("");
      typeText(view, "`code` ");
      expect(collectMarks(view.state.doc).has("inline_code")).toBe(true);
    });

    it("~~strike~~ + space creates strikethrough mark", () => {
      view = createEditor("");
      typeText(view, "~~strike~~ ");
      expect(collectMarks(view.state.doc).has("delete")).toBe(true);
    });

    it("__bold__ + space creates strong mark", () => {
      view = createEditor("");
      typeText(view, "__bold__ ");
      expect(collectMarks(view.state.doc).has("strong")).toBe(true);
    });

    it("_italic_ + space creates em mark", () => {
      view = createEditor("");
      typeText(view, "_italic_ ");
      expect(collectMarks(view.state.doc).has("emphasis")).toBe(true);
    });

    it("__bold__ does NOT prematurely trigger emphasis (underscore)", () => {
      view = createEditor("");
      typeText(view, "__bold__ ");
      const marks = collectMarks(view.state.doc);
      expect(marks.has("strong")).toBe(true);
      expect(marks.has("emphasis")).toBe(false);
    });

    it("mark input rule preserves surrounding text", () => {
      view = createEditor("");
      typeText(view, "hello **world** rest");
      const para = firstChild(view);
      expect(para.textContent).toBe("hello world rest");
      let foundStrong = false;
      para.descendants((node) => {
        if (node.isText && node.text === "world") {
          foundStrong = node.marks.some((m) => m.type.name === "strong");
        }
      });
      expect(foundStrong).toBe(true);
    });

    it("multiple marks in same paragraph", () => {
      view = createEditor("");
      typeText(view, "**bold** and *italic* done");
      const marks = collectMarks(view.state.doc);
      expect(marks.has("strong")).toBe(true);
      expect(marks.has("emphasis")).toBe(true);
    });
  });
});

// ========== Keymap Command Tests ==========

describe("Keymap commands", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  describe("mark toggle shortcuts", () => {
    it("toggleMark(strong) applies strong to selection", () => {
      view = createEditor("hello world\n");
      selectRange(view, 7, 12); // "world"
      runCommand(view, toggleMark(schema.marks.strong));
      const node = view.state.doc.nodeAt(7);
      expect(node?.marks.some((m) => m.type.name === "strong")).toBe(true);
    });

    it("toggleMark(em) applies em to selection", () => {
      view = createEditor("hello world\n");
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.emphasis));
      const node = view.state.doc.nodeAt(7);
      expect(node?.marks.some((m) => m.type.name === "emphasis")).toBe(true);
    });

    it("toggleMark(code) applies inline code to selection", () => {
      view = createEditor("hello world\n");
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.inline_code));
      const node = view.state.doc.nodeAt(7);
      expect(node?.marks.some((m) => m.type.name === "inline_code")).toBe(true);
    });

    it("toggleMark(strikethrough) applies strikethrough to selection", () => {
      view = createEditor("hello world\n");
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.delete));
      const node = view.state.doc.nodeAt(7);
      expect(node?.marks.some((m) => m.type.name === "delete")).toBe(true);
    });

    it("toggling strong twice removes the mark", () => {
      view = createEditor("hello world\n");
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.strong));
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.strong));
      const node = view.state.doc.nodeAt(7);
      expect(node?.marks.some((m) => m.type.name === "strong")).toBe(false);
    });

    it("multiple marks can coexist on same text", () => {
      view = createEditor("hello world\n");
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.strong));
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.emphasis));
      const node = view.state.doc.nodeAt(7);
      expect(node?.marks.some((m) => m.type.name === "strong")).toBe(true);
      expect(node?.marks.some((m) => m.type.name === "emphasis")).toBe(true);
    });

    it("code mark excludes other marks", () => {
      view = createEditor("hello world\n");
      // First apply strong
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.strong));
      // Then apply code — should remove strong (code excludes "_" = all)
      selectRange(view, 7, 12);
      runCommand(view, toggleMark(schema.marks.inline_code));
      const node = view.state.doc.nodeAt(7);
      expect(node?.marks.some((m) => m.type.name === "inline_code")).toBe(true);
      expect(node?.marks.some((m) => m.type.name === "strong")).toBe(false);
    });
  });

  describe("block type shortcuts", () => {
    it("setBlockType to heading level 1", () => {
      view = createEditor("hello\n");
      runCommand(view, setBlockType(schema.nodes.heading, { depth: 1 }));
      expect(firstChild(view).type.name).toBe("heading");
      expect(firstChild(view).attrs.depth).toBe(1);
    });

    it("setBlockType to heading level 3", () => {
      view = createEditor("hello\n");
      runCommand(view, setBlockType(schema.nodes.heading, { depth: 3 }));
      expect(firstChild(view).type.name).toBe("heading");
      expect(firstChild(view).attrs.depth).toBe(3);
    });

    it("setBlockType back to paragraph", () => {
      view = createEditor("hello\n");
      runCommand(view, setBlockType(schema.nodes.heading, { depth: 2 }));
      expect(firstChild(view).type.name).toBe("heading");
      runCommand(view, setBlockType(schema.nodes.paragraph));
      expect(firstChild(view).type.name).toBe("paragraph");
    });
  });

  describe("list shortcuts", () => {
    it("wrapInList creates bullet list", () => {
      view = createEditor("item\n");
      runCommand(view, wrapInList(schema.nodes.list));
      expect(firstChild(view).type.name).toBe("list");
    });

    it("wrapInList creates ordered list", () => {
      view = createEditor("item\n");
      runCommand(view, wrapInList(schema.nodes.list, { ordered: true }));
      expect(firstChild(view).type.name).toBe("list");
    });

    it("sinkListItem indents a list item", () => {
      view = createEditor("- one\n- two\n");
      // Move cursor to second item's text
      setCursor(view, 11);
      const success = runCommand(view, sinkListItem(schema.nodes.list_item));
      expect(success).toBe(true);
      // After sinking, the first list_item should contain a nested bullet_list
      const bulletList = firstChild(view);
      const firstItem = bulletList.firstChild!;
      expect(firstItem.childCount).toBe(2);
      expect(firstItem.lastChild!.type.name).toBe("list");
    });
  });
});

// ========== Complex Interaction Workflows ==========

describe("Complex workflows", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  it("typing heading then continuing with text", () => {
    view = createEditor("");
    typeText(view, "## My Title");
    expect(firstChild(view).type.name).toBe("heading");
    expect(firstChild(view).textContent).toBe("My Title");
    expect(firstChild(view).attrs.depth).toBe(2);
  });

  it("creating bullet list and typing items", () => {
    view = createEditor("");
    typeText(view, "- first item");
    expect(firstChild(view).type.name).toBe("list");
    expect(firstChild(view).firstChild!.firstChild!.textContent).toBe("first item");
  });

  it("creating ordered list with custom start number", () => {
    view = createEditor("");
    typeText(view, "5. item five");
    const ol = firstChild(view);
    expect(ol.type.name).toBe("list");
    expect(ol.attrs.start).toBe(5);
    expect(ol.firstChild!.firstChild!.textContent).toBe("item five");
  });

  it("typing bold and italic in same line", () => {
    view = createEditor("");
    typeText(view, "This is **bold** and *italic* text");
    const para = firstChild(view);
    expect(para.textContent).toBe("This is bold and italic text");
    const marks = collectMarks(view.state.doc);
    expect(marks.has("strong")).toBe(true);
    expect(marks.has("emphasis")).toBe(true);
  });

  it("code block preserves language attribute", () => {
    view = createEditor("");
    typeText(view, "```typescript");
    runCommand(view, getCodeBlockCommands().Enter);
    expect(firstChild(view).type.name).toBe("code");
    expect(firstChild(view).attrs.lang).toBe("typescript");
  });

  it("typing inside code block (no marks applied)", () => {
    view = createEditor("");
    typeText(view, "```js");
    runCommand(view, getCodeBlockCommands().Enter);
    typeText(view, "const x = 1;");
    const block = firstChild(view);
    expect(block.type.name).toBe("code");
    expect(block.textContent).toBe("const x = 1;");
    expect(collectMarks(view.state.doc).size).toBe(0);
  });

  it("**bold** inside code block is NOT formatted", () => {
    view = createEditor("");
    typeText(view, "```");
    runCommand(view, getCodeBlockCommands().Enter);
    typeText(view, "**not bold** ");
    const block = firstChild(view);
    expect(block.type.name).toBe("code");
    expect(block.textContent).toBe("**not bold** ");
    expect(collectMarks(view.state.doc).size).toBe(0);
  });

  it("blockquote wrapping preserves subsequent text", () => {
    view = createEditor("");
    typeText(view, "> This is quoted");
    const bq = firstChild(view);
    expect(bq.type.name).toBe("blockquote");
    expect(bq.firstChild!.textContent).toBe("This is quoted");
  });

  it("horizontal rule creates paragraph after it for continued typing", () => {
    view = createEditor("");
    typeText(view, "---");
    expect(topLevelTypes(view.state.doc)).toContain("thematic_break");
  });

  it("mark input rules work inside heading", () => {
    view = createEditor("");
    typeText(view, "## **bold heading** rest");
    const heading = firstChild(view);
    expect(heading.type.name).toBe("heading");
    expect(heading.textContent).toBe("bold heading rest");
    expect(collectMarks(view.state.doc).has("strong")).toBe(true);
  });

  it("inline code inside blockquote", () => {
    view = createEditor("");
    typeText(view, "> Use `console.log` here");
    const bq = firstChild(view);
    expect(bq.type.name).toBe("blockquote");
    expect(bq.firstChild!.textContent).toBe("Use console.log here");
    expect(collectMarks(view.state.doc).has("inline_code")).toBe(true);
  });

  it("bold inside list item", () => {
    view = createEditor("");
    typeText(view, "- **important** item");
    const list = firstChild(view);
    expect(list.type.name).toBe("list");
    expect(list.firstChild!.firstChild!.textContent).toBe("important item");
    expect(collectMarks(view.state.doc).has("strong")).toBe(true);
  });
});

// ========== Code Block Keymap Tests ==========

describe("Code block keymaps", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  describe("Tab — insert 2 spaces", () => {
    it("inserts 2 spaces at cursor in code block", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      const codeBlock = firstChild(view);
      expect(codeBlock.type.name).toBe("code");
      // Place cursor at start of code block content (pos 1 = inside code_block)
      setCursor(view, 1);
      // Find the Tab command from the keymap
      const { Tab } = getCodeBlockCommands();
      runCommand(view, Tab);
      expect(firstChild(view).textContent).toBe("  const x = 1;");
    });

    it("replaces selection with 2 spaces", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      // Select "const" (positions 1 through 6)
      selectRange(view, 1, 6);
      const { Tab } = getCodeBlockCommands();
      runCommand(view, Tab);
      expect(firstChild(view).textContent).toBe("   x = 1;");
    });

    it("returns false when not in a code block", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { Tab } = getCodeBlockCommands();
      const result = runCommand(view, Tab);
      expect(result).toBe(false);
    });
  });

  describe("Enter inside code block", () => {
    it("inserts a newline when already inside a code block", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      setCursor(view, 8);

      typeText(view, "\n");

      expect(firstChild(view).type.name).toBe("code");
      expect(firstChild(view).textContent).toContain("\n");
    });
  });

  describe("Shift-Tab — outdent", () => {
    it("removes 2 leading spaces from current line", () => {
      view = createEditor("```js\n  const x = 1;\n```\n");
      // Cursor somewhere on the line with leading spaces
      setCursor(view, 3);
      const { "Shift-Tab": shiftTab } = getCodeBlockCommands();
      runCommand(view, shiftTab);
      expect(firstChild(view).textContent).toBe("const x = 1;");
    });

    it("removes only 1 space if only 1 leading space", () => {
      view = createEditor("```js\n const x = 1;\n```\n");
      setCursor(view, 2);
      const { "Shift-Tab": shiftTab } = getCodeBlockCommands();
      runCommand(view, shiftTab);
      expect(firstChild(view).textContent).toBe("const x = 1;");
    });

    it("does nothing when no leading spaces", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      setCursor(view, 3);
      const { "Shift-Tab": shiftTab } = getCodeBlockCommands();
      runCommand(view, shiftTab);
      expect(firstChild(view).textContent).toBe("const x = 1;");
    });

    it("outdents correct line in multi-line code block", () => {
      view = createEditor("```js\nline1\n  line2\n```\n");
      const codeBlock = firstChild(view);
      // Find the offset for line2 (after "line1\n  ")
      const text = codeBlock.textContent;
      const line2Start = text.indexOf("line2");
      setCursor(view, 1 + line2Start); // 1 is the start of code block content
      const { "Shift-Tab": shiftTab } = getCodeBlockCommands();
      runCommand(view, shiftTab);
      expect(firstChild(view).textContent).toBe("line1\nline2");
    });

    it("returns false when not in a code block", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { "Shift-Tab": shiftTab } = getCodeBlockCommands();
      const result = runCommand(view, shiftTab);
      expect(result).toBe(false);
    });
  });

  describe("Mod-Enter — exit code block", () => {
    it("creates paragraph below code block", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      setCursor(view, 1);
      const { "Mod-Enter": modEnter } = getCodeBlockCommands();
      runCommand(view, modEnter);
      const types = topLevelTypes(view.state.doc);
      expect(types[0]).toBe("code");
      expect(types[1]).toBe("paragraph");
    });

    it("moves cursor to the new paragraph", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      setCursor(view, 1);
      const { "Mod-Enter": modEnter } = getCodeBlockCommands();
      runCommand(view, modEnter);
      // Cursor should be in the new paragraph
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
    });

    it("returns false when not in a code block", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { "Mod-Enter": modEnter } = getCodeBlockCommands();
      const result = runCommand(view, modEnter);
      expect(result).toBe(false);
    });
  });

  describe("ArrowDown at last line — exit code block", () => {
    it("exits code block when cursor is on last line", () => {
      view = createEditor("```js\nconst x = 1;\n```\n\nhello\n");
      const codeBlock = firstChild(view);
      // Place cursor at end of code block content (last line)
      const endOfContent = 1 + codeBlock.textContent.length;
      setCursor(view, endOfContent);
      const { ArrowDown: arrowDown } = getCodeBlockCommands();
      runCommand(view, arrowDown);
      // Cursor should be in the paragraph after
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
    });

    it("creates paragraph when no next block exists", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      const codeBlock = firstChild(view);
      const endOfContent = 1 + codeBlock.textContent.length;
      setCursor(view, endOfContent);
      const { ArrowDown: arrowDown } = getCodeBlockCommands();
      runCommand(view, arrowDown);
      const types = topLevelTypes(view.state.doc);
      expect(types).toContain("paragraph");
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
    });

    it("does not exit when cursor is not on last line", () => {
      view = createEditor("```js\nline1\nline2\n```\n");
      // Place cursor on first line (offset 0-4 = "line1", before \n at offset 5)
      setCursor(view, 1); // start of "line1"
      const { ArrowDown: arrowDown } = getCodeBlockCommands();
      const result = runCommand(view, arrowDown);
      expect(result).toBe(false);
    });

    it("returns false when not in a code block", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { ArrowDown: arrowDown } = getCodeBlockCommands();
      const result = runCommand(view, arrowDown);
      expect(result).toBe(false);
    });
  });

  describe("Backspace on empty code block — convert to paragraph", () => {
    it("converts empty code block to paragraph", () => {
      view = createEditor("");
      typeText(view, "```");
      runCommand(view, getCodeBlockCommands().Enter);
      expect(firstChild(view).type.name).toBe("code");
      // Cursor should be at position 1 (inside empty code block)
      const { Backspace: backspace } = getCodeBlockCommands();
      runCommand(view, backspace);
      expect(firstChild(view).type.name).toBe("paragraph");
    });

    it("does not convert non-empty code block", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      setCursor(view, 1);
      const { Backspace: backspace } = getCodeBlockCommands();
      const result = runCommand(view, backspace);
      expect(result).toBe(false);
    });

    it("returns false when not in a code block", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { Backspace: backspace } = getCodeBlockCommands();
      const result = runCommand(view, backspace);
      expect(result).toBe(false);
    });
  });
});

// ========== Serialization Roundtrip After Interaction ==========

describe("Serialize after interaction", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  it("heading typed via input rule serializes correctly", () => {
    view = createEditor("");
    typeText(view, "## Hello World");
    const md = serializeMarkdown(view.state.doc);
    expect(md.trim()).toBe("## Hello World");
  });

  it("bold typed via input rule serializes correctly", () => {
    view = createEditor("");
    typeText(view, "This is **bold** text");
    const md = serializeMarkdown(view.state.doc);
    expect(md.trim()).toBe("This is **bold** text");
  });

  it("italic typed via input rule serializes correctly", () => {
    view = createEditor("");
    typeText(view, "This is *italic* text");
    const md = serializeMarkdown(view.state.doc);
    expect(md.trim()).toBe("This is *italic* text");
  });

  it("inline code typed via input rule serializes correctly", () => {
    view = createEditor("");
    typeText(view, "Use `code` here");
    const md = serializeMarkdown(view.state.doc);
    expect(md.trim()).toBe("Use `code` here");
  });

  it("strikethrough typed via input rule serializes correctly", () => {
    view = createEditor("");
    typeText(view, "This is ~~deleted~~ text");
    const md = serializeMarkdown(view.state.doc);
    expect(md.trim()).toBe("This is ~~deleted~~ text");
  });

  it("bullet list typed via input rule serializes correctly", () => {
    view = createEditor("");
    typeText(view, "- hello");
    const md = serializeMarkdown(view.state.doc);
    expect(md.trim()).toMatch(/^[-*+] hello$/);
  });

  it("code block typed via Enter keymap serializes correctly", () => {
    view = createEditor("");
    typeText(view, "```javascript");
    runCommand(view, getCodeBlockCommands().Enter);
    typeText(view, 'console.log("hi")');
    const md = serializeMarkdown(view.state.doc);
    expect(md).toContain("```javascript");
    expect(md).toContain('console.log("hi")');
  });

  it("mark toggle via command serializes correctly", () => {
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    runCommand(view, toggleMark(schema.marks.strong));
    const md = serializeMarkdown(view.state.doc);
    expect(md.trim()).toBe("hello **world**");
  });
});

describe("Non-IME undo/redo", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  it("undo/redo round-trips plain typing", async () => {
    view = createEditor("hello\n");
    setCursor(view, 6);
    typeText(view, " world");
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello world");

    const { undo, redo } = await import("prosemirror-history");
    undo(view.state, view.dispatch.bind(view));
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello");

    redo(view.state, view.dispatch.bind(view));
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello world");
  });

  it("undo/redo round-trips mark toggle", async () => {
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    runCommand(view, toggleMark(schema.marks.strong));
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello **world**");

    const { undo, redo } = await import("prosemirror-history");
    undo(view.state, view.dispatch.bind(view));
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello world");

    redo(view.state, view.dispatch.bind(view));
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello **world**");
  });
});

// ========== Link Toggle (Mod-k) Tests ==========

describe("Link toggle (Mod-k)", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
    vi.restoreAllMocks();
  });

  function getLinkKeymap() {
    return linkExt.keymap!(schema) as {
      "Mod-k": (
        state: EditorState,
        dispatch?: (tr: Transaction) => void,
        view?: EditorView,
      ) => boolean;
    };
  }

  it("applies link mark to selected text when URL is provided", () => {
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    view = createEditor("hello world\n");
    selectRange(view, 7, 12); // "world"
    const { "Mod-k": modK } = getLinkKeymap();
    const result = modK(view.state, view.dispatch.bind(view), view);
    expect(result).toBe(true);
    const node = view.state.doc.nodeAt(7);
    expect(node?.marks.some((m) => m.type.name === "link")).toBe(true);
    const linkMark = node?.marks.find((m) => m.type.name === "link");
    expect(linkMark?.attrs.url).toBe("https://example.com");
  });

  it("removes link mark from selected linked text", () => {
    view = createEditor("click [here](https://example.com) for more\n");
    // Find the link mark position dynamically
    let linkFrom = -1;
    let linkTo = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((m) => m.type.name === "link")) {
        linkFrom = pos;
        linkTo = pos + node.nodeSize;
      }
    });
    expect(linkFrom).toBeGreaterThan(0);
    selectRange(view, linkFrom, linkTo);
    const { "Mod-k": modK } = getLinkKeymap();
    const result = modK(view.state, view.dispatch.bind(view), view);
    expect(result).toBe(true);
    // Verify link is removed
    const nodeAfter = view.state.doc.nodeAt(linkFrom);
    expect(nodeAfter?.marks.some((m) => m.type.name === "link")).toBe(false);
  });

  it("removes link mark when cursor is inside a link", () => {
    view = createEditor("click [here](https://example.com) for more\n");
    let linkFrom = -1;
    let linkTo = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((m) => m.type.name === "link")) {
        linkFrom = pos;
        linkTo = pos + node.nodeSize;
      }
    });
    expect(linkFrom).toBeGreaterThan(0);
    // Place cursor inside the link (not at boundary, so marks() includes it)
    setCursor(view, linkFrom + 1);
    const { "Mod-k": modK } = getLinkKeymap();
    const result = modK(view.state, view.dispatch.bind(view), view);
    expect(result).toBe(true);
    // Verify link is removed from the entire extent
    view.state.doc.nodesBetween(linkFrom, linkTo, (node) => {
      if (node.isText) {
        expect(node.marks.some((m) => m.type.name === "link")).toBe(false);
      }
    });
  });

  it("returns false when no selection and cursor not in link", () => {
    view = createEditor("hello world\n");
    setCursor(view, 3);
    const { "Mod-k": modK } = getLinkKeymap();
    const result = modK(view.state, view.dispatch.bind(view), view);
    expect(result).toBe(false);
  });

  it("returns false when prompt is cancelled", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    const { "Mod-k": modK } = getLinkKeymap();
    const result = modK(view.state, view.dispatch.bind(view), view);
    expect(result).toBe(false);
    expect(collectMarks(view.state.doc).has("link")).toBe(false);
  });

  it("serializes linked text correctly after Mod-k", () => {
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    const { "Mod-k": modK } = getLinkKeymap();
    modK(view.state, view.dispatch.bind(view), view);
    const md = serializeMarkdown(view.state.doc);
    expect(md.trim()).toBe("hello [world](https://example.com)");
  });
});

// ========== Paste URL on Selection Tests ==========

describe("Paste URL on selection", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  /** Directly invoke the paste plugin's handlePaste with a mock event. */
  function callHandlePaste(v: EditorView, text: string): boolean {
    const plugin = createPastePlugin();
    const handlePaste = plugin.props.handlePaste!;
    const mockEvent = {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? text : ""),
      },
    } as unknown as ClipboardEvent;
    return handlePaste.call(plugin, v, mockEvent, Slice.empty) as boolean;
  }

  it("wraps selected text in link when URL is pasted", () => {
    view = createEditor("hello world\n");
    selectRange(view, 7, 12); // "world"
    const result = callHandlePaste(view, "https://example.com");
    expect(result).toBe(true);
    const node = view.state.doc.nodeAt(7);
    expect(node?.marks.some((m) => m.type.name === "link")).toBe(true);
    expect(node?.marks.find((m) => m.type.name === "link")?.attrs.url).toBe("https://example.com");
  });

  it("does nothing when no text is selected", () => {
    view = createEditor("hello world\n");
    setCursor(view, 3);
    const result = callHandlePaste(view, "https://example.com");
    expect(result).toBe(false);
  });

  it("does nothing when pasted text is not a URL", () => {
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    const result = callHandlePaste(view, "not a url");
    expect(result).toBe(false);
  });

  it("trims whitespace around pasted URL", () => {
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    const result = callHandlePaste(view, "  https://example.com  ");
    expect(result).toBe(true);
    const node = view.state.doc.nodeAt(7);
    expect(node?.marks.find((m) => m.type.name === "link")?.attrs.url).toBe("https://example.com");
  });

  it("handles various URL protocols", () => {
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    const result = callHandlePaste(view, "ftp://files.example.com/doc");
    expect(result).toBe(true);
    const node = view.state.doc.nodeAt(7);
    expect(node?.marks.find((m) => m.type.name === "link")?.attrs.url).toBe(
      "ftp://files.example.com/doc",
    );
  });

  it("does nothing when clipboard is empty", () => {
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    const result = callHandlePaste(view, "");
    expect(result).toBe(false);
  });
});

// ========== Table Cell Navigation Tests ==========

describe("Table cell navigation", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  describe("Tab — next cell", () => {
    it("Tab in first cell moves to second cell", () => {
      view = createEditor("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n");
      // Place cursor in first header cell (cell "a")
      const doc = view.state.doc;
      let aPos = -1;
      doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes("a") && aPos === -1) {
          aPos = pos;
        }
      });
      setCursor(view, aPos);
      expect(findCellInfo(view)?.cellType).toBe("table_cell");

      const { Tab } = getTableCommands();
      runCommand(view, Tab);

      // Should now be in the second header cell
      const info = findCellInfo(view);
      expect(info).not.toBeNull();
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("table_cell");
    });

    it("Tab in last cell of row moves to first cell of next row", () => {
      view = createEditor("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n");
      let cPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes("c") && cPos === -1) {
          cPos = pos;
        }
      });
      setCursor(view, cPos);

      const { Tab } = getTableCommands();
      runCommand(view, Tab);

      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("table_cell");
    });

    it("Tab in last cell of last row creates new row", () => {
      view = createEditor("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n");
      let pos3 = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes("3") && pos3 === -1) {
          pos3 = pos;
        }
      });
      setCursor(view, pos3);

      const rowCountBefore = view.state.doc.firstChild!.childCount;
      const { Tab } = getTableCommands();
      runCommand(view, Tab);

      const rowCountAfter = view.state.doc.firstChild!.childCount;
      expect(rowCountAfter).toBe(rowCountBefore + 1);

      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("table_cell");
    });
  });

  describe("Shift-Tab — previous cell", () => {
    it("Shift-Tab in second cell moves to first cell", () => {
      view = createEditor("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n");
      let bPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes("b") && bPos === -1) {
          bPos = pos;
        }
      });
      setCursor(view, bPos);

      const { "Shift-Tab": shiftTab } = getTableCommands();
      runCommand(view, shiftTab);

      const info = findCellInfo(view);
      expect(info).not.toBeNull();
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("table_cell");
    });

    it("Shift-Tab in first cell of second row moves to last cell of first row", () => {
      view = createEditor("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n");
      let pos1 = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes("1") && pos1 === -1) {
          pos1 = pos;
        }
      });
      setCursor(view, pos1);
      expect(findCellInfo(view)?.cellType).toBe("table_cell");

      const { "Shift-Tab": shiftTab } = getTableCommands();
      runCommand(view, shiftTab);

      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("table_cell");
    });

    it("Shift-Tab in first cell of first row does nothing (returns true)", () => {
      view = createEditor("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n");
      let aPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes("a") && aPos === -1) {
          aPos = pos;
        }
      });
      setCursor(view, aPos);
      const posBefore = view.state.selection.from;

      const { "Shift-Tab": shiftTab } = getTableCommands();
      const result = runCommand(view, shiftTab);

      expect(result).toBe(true);
      expect(view.state.selection.from).toBe(posBefore);
    });
  });

  describe("Tab returns false outside table", () => {
    it("Tab in paragraph returns false", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { Tab } = getTableCommands();
      expect(runCommand(view, Tab)).toBe(false);
    });

    it("Shift-Tab in paragraph returns false", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { "Shift-Tab": shiftTab } = getTableCommands();
      expect(runCommand(view, shiftTab)).toBe(false);
    });
  });
});

// ========== Task List Input Rule Tests ==========

describe("Task list input rules", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  it("typing '- [ ] ' sets checked to false on list item", () => {
    view = createEditor("");
    // First create a bullet list by typing "- "
    typeText(view, "- ");
    expect(firstChild(view).type.name).toBe("list");
    // Now type "[ ] " to trigger the task list input rule
    typeText(view, "[ ] ");
    // The list_item should have checked: false
    const listItem = firstChild(view).firstChild!;
    expect(listItem.type.name).toBe("list_item");
    expect(listItem.attrs.checked).toBe(false);
  });

  it("typing '- [x] ' sets checked to true on list item", () => {
    view = createEditor("");
    typeText(view, "- ");
    expect(firstChild(view).type.name).toBe("list");
    typeText(view, "[x] ");
    const listItem = firstChild(view).firstChild!;
    expect(listItem.type.name).toBe("list_item");
    expect(listItem.attrs.checked).toBe(true);
  });

  it("task list input rule removes the trigger text", () => {
    view = createEditor("");
    typeText(view, "- ");
    typeText(view, "[ ] ");
    // The paragraph inside the list_item should be empty (trigger text deleted)
    const listItem = firstChild(view).firstChild!;
    const paragraph = listItem.firstChild!;
    expect(paragraph.textContent).toBe("");
  });

  it("task list roundtrips through markdown", () => {
    view = createEditor("");
    typeText(view, "- ");
    typeText(view, "[x] ");
    typeText(view, "done item");
    const md = serializeMarkdown(view.state.doc);
    expect(md).toContain("[x]");
    expect(md).toContain("done item");
  });

  it("'[ ] ' outside a list does nothing", () => {
    view = createEditor("");
    typeText(view, "[ ] ");
    // Should still be a plain paragraph
    expect(firstChild(view).type.name).toBe("paragraph");
    expect(firstChild(view).textContent).toBe("[ ] ");
  });
});

describe("Heading and list editing behavior", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  it("Enter at end of heading creates a following paragraph", () => {
    view = createEditor("## Title\n");
    setCursor(view, 7);
    runCommand(view, createParagraphNear);
    expect(topLevelTypes(view.state.doc)).toEqual(["heading", "paragraph"]);
  });

  it("Enter in list item creates another list item", () => {
    view = createEditor("- one\n");
    setCursor(view, 5);
    runCommand(view, splitListItem(schema.nodes.list_item));
    expect(firstChild(view).type.name).toBe("list");
    expect(firstChild(view).childCount).toBe(2);
  });

  it("Backspace at start of second list item does not break list structure", () => {
    view = createEditor("- one\n- two\n");
    let secondItemPos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "two" && secondItemPos === -1) {
        secondItemPos = pos + 1;
      }
    });
    setCursor(view, secondItemPos);
    typeText(view, "\b");
    expect(firstChild(view).type.name).toBe("list");
  });
});

// ========== Blockquote Exit Behavior Tests ==========

describe("Blockquote exit behaviors", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  /** Get the blockquote keymap commands from the extension. */
  function getBlockquoteCommands() {
    return blockquoteExt.keymap!(schema) as {
      Backspace: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
      Enter: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
    };
  }

  describe("Backspace on empty paragraph in blockquote", () => {
    it("returns true on valid path even without dispatch", () => {
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create()]),
      ]);
      const state = createEditorState(doc);
      const result = getBlockquoteCommands().Backspace(
        state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2))),
      );
      expect(result).toBe(true);
    });

    it("lifts empty paragraph out of blockquote", () => {
      // Create a blockquote with a single empty paragraph
      view = createEditor("");
      typeText(view, "> ");
      expect(firstChild(view).type.name).toBe("blockquote");

      // Cursor should be inside the empty paragraph within the blockquote
      const { Backspace: backspace } = getBlockquoteCommands();
      const result = runCommand(view, backspace);
      expect(result).toBe(true);
      // The blockquote should be gone; first child should be a paragraph
      expect(firstChild(view).type.name).toBe("paragraph");
    });

    it("does not fire in non-empty paragraph", () => {
      view = createEditor("> hello\n");
      // Place cursor at start of "hello" inside blockquote
      // doc > blockquote > paragraph > "hello"
      // pos 1 = start of blockquote, pos 2 = start of paragraph, pos 3 = before "h"
      setCursor(view, 3);
      const { Backspace: backspace } = getBlockquoteCommands();
      const result = runCommand(view, backspace);
      expect(result).toBe(false);
    });

    it("does not fire when cursor is not at start of textblock", () => {
      view = createEditor("> hi\n");
      // Place cursor after "h" — parentOffset > 0
      setCursor(view, 4);
      const { Backspace: backspace } = getBlockquoteCommands();
      const result = runCommand(view, backspace);
      expect(result).toBe(false);
    });

    it("splits blockquote around middle empty paragraph", () => {
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.blockquote.create(null, [
          schema.nodes.paragraph.create(null, [schema.text("one")]),
          schema.nodes.paragraph.create(),
          schema.nodes.paragraph.create(null, [schema.text("two")]),
        ]),
      ]);
      const state = createEditorState(doc);
      const el = document.createElement("div");
      document.body.appendChild(el);
      view = new EditorView(el, { state });

      let emptyPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.content.size === 0 && emptyPos === -1) {
          emptyPos = pos + 1;
        }
      });
      setCursor(view, emptyPos);

      const result = runCommand(view, getBlockquoteCommands().Backspace);
      expect(result).toBe(true);
      expect(topLevelTypes(view.state.doc)).toEqual(["blockquote", "paragraph", "blockquote"]);
      expect(view.state.doc.child(0).textContent).toContain("one");
      expect(view.state.doc.child(2).textContent).toContain("two");
    });
  });

  describe("Enter on empty paragraph in blockquote", () => {
    it("returns true on valid path even without dispatch", () => {
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create()]),
      ]);
      const state = createEditorState(doc);
      const result = getBlockquoteCommands().Enter(
        state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2))),
      );
      expect(result).toBe(true);
    });

    it("replaces single-child blockquote with paragraph", () => {
      view = createEditor("");
      typeText(view, "> ");
      expect(firstChild(view).type.name).toBe("blockquote");

      const { Enter: enter } = getBlockquoteCommands();
      const result = runCommand(view, enter);
      expect(result).toBe(true);
      // Blockquote should be replaced with a plain paragraph
      expect(firstChild(view).type.name).toBe("paragraph");
      expect(topLevelTypes(view.state.doc)).not.toContain("blockquote");
    });

    it("exits from last empty paragraph in multi-child blockquote", () => {
      // Build doc programmatically: blockquote(paragraph("hello"), paragraph())
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.blockquote.create(null, [
          schema.nodes.paragraph.create(null, [schema.text("hello")]),
          schema.nodes.paragraph.create(),
        ]),
      ]);
      const state = createEditorState(doc);
      const el = document.createElement("div");
      document.body.appendChild(el);
      view = new EditorView(el, { state });

      const bq = firstChild(view);
      expect(bq.type.name).toBe("blockquote");
      expect(bq.childCount).toBe(2);

      // Place cursor inside the second (empty) paragraph
      let emptyParaPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.content.size === 0 && emptyParaPos === -1) {
          emptyParaPos = pos + 1; // inside the empty paragraph
        }
      });
      expect(emptyParaPos).toBeGreaterThan(0);
      setCursor(view, emptyParaPos);

      const { Enter: enter } = getBlockquoteCommands();
      const result = runCommand(view, enter);
      expect(result).toBe(true);

      // Blockquote should still contain "hello"
      const types = topLevelTypes(view.state.doc);
      expect(types).toContain("blockquote");
      const newBq = view.state.doc.firstChild!;
      expect(newBq.type.name).toBe("blockquote");
      expect(newBq.firstChild!.textContent).toBe("hello");
      // A paragraph should exist after the blockquote
      expect(types.indexOf("paragraph")).toBeGreaterThan(types.indexOf("blockquote"));
    });

    it("does not fire in non-empty paragraph", () => {
      view = createEditor("> hello\n");
      setCursor(view, 3);
      const { Enter: enter } = getBlockquoteCommands();
      const result = runCommand(view, enter);
      expect(result).toBe(false);
    });

    it("splits blockquote around middle empty paragraph", () => {
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.blockquote.create(null, [
          schema.nodes.paragraph.create(null, [schema.text("alpha")]),
          schema.nodes.paragraph.create(),
          schema.nodes.paragraph.create(null, [schema.text("omega")]),
        ]),
      ]);
      const state = createEditorState(doc);
      const el = document.createElement("div");
      document.body.appendChild(el);
      view = new EditorView(el, { state });

      let emptyPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.content.size === 0 && emptyPos === -1) {
          emptyPos = pos + 1;
        }
      });
      setCursor(view, emptyPos);

      const result = runCommand(view, getBlockquoteCommands().Enter);
      expect(result).toBe(true);
      expect(topLevelTypes(view.state.doc)).toEqual(["blockquote", "paragraph", "blockquote"]);
      expect(view.state.doc.child(0).textContent).toContain("alpha");
      expect(view.state.doc.child(2).textContent).toContain("omega");
    });
  });
});

// ========== Table Enter / Backspace / Delete Tests ==========

describe("Table Enter/Backspace/Delete keymaps", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  /** Helper: find position of text in doc. */
  function findTextPos(v: EditorView, text: string): number {
    let found = -1;
    v.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes(text) && found === -1) {
        found = pos;
      }
    });
    return found;
  }

  describe("Enter in table", () => {
    it("moves to same column in next row", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const aPos = findTextPos(view, "a");
      setCursor(view, aPos);
      expect(findCellInfo(view)?.cellType).toBe("table_cell");
      expect(findCellInfo(view)?.cellIdx).toBe(0);

      const { Enter } = getTableCommands();
      runCommand(view, Enter);

      // Should be in first cell of second row (data row)
      const info = findCellInfo(view);
      expect(info?.cellType).toBe("table_cell");
      expect(info?.cellIdx).toBe(0);
      expect(info?.cellText).toBe("1");
    });

    it("moves to same column in next row (second column)", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const bPos = findTextPos(view, "b");
      setCursor(view, bPos);
      expect(findCellInfo(view)?.cellIdx).toBe(1);

      const { Enter } = getTableCommands();
      runCommand(view, Enter);

      const info = findCellInfo(view);
      expect(info?.cellType).toBe("table_cell");
      expect(info?.cellIdx).toBe(1);
      expect(info?.cellText).toBe("2");
    });

    it("exits table from last row (inserts paragraph below)", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const pos1 = findTextPos(view, "1");
      setCursor(view, pos1);

      const { Enter } = getTableCommands();
      runCommand(view, Enter);

      // Should be in a paragraph after the table
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
      // Table should still exist
      expect(topLevelTypes(view.state.doc)).toContain("table");
      expect(topLevelTypes(view.state.doc)).toContain("paragraph");
    });

    it("does not affect structure (no extra columns/rows)", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const aPos = findTextPos(view, "a");
      setCursor(view, aPos);

      const tableBefore = view.state.doc.firstChild!;
      const rowCountBefore = tableBefore.childCount;
      const colCountBefore = tableBefore.firstChild!.childCount;

      const { Enter } = getTableCommands();
      runCommand(view, Enter);

      // Table structure should be unchanged
      const tableAfter = view.state.doc.firstChild!;
      expect(tableAfter.childCount).toBe(rowCountBefore);
      expect(tableAfter.firstChild!.childCount).toBe(colCountBefore);
    });

    it("returns false outside table", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { Enter } = getTableCommands();
      expect(runCommand(view, Enter)).toBe(false);
    });
  });

  describe("Backspace at cell start", () => {
    it("does nothing at first cell of first row", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const aPos = findTextPos(view, "a");
      setCursor(view, aPos); // cursor before "a"
      const posBefore = view.state.selection.from;

      const { Backspace } = getTableCommands();
      const result = runCommand(view, Backspace);

      expect(result).toBe(true); // consumed the key
      expect(view.state.selection.from).toBe(posBefore); // cursor didn't move
      // Table structure preserved
      expect(view.state.doc.firstChild!.childCount).toBe(2);
    });

    it("moves cursor to end of previous cell in same row", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const bPos = findTextPos(view, "b");
      setCursor(view, bPos); // cursor at start of "b" cell

      const { Backspace } = getTableCommands();
      runCommand(view, Backspace);

      // Cursor should now be at the end of the "a" cell
      const info = findCellInfo(view);
      expect(info?.cellText).toBe("a");
    });

    it("moves cursor to last cell of previous row", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const pos1 = findTextPos(view, "1");
      setCursor(view, pos1);

      const { Backspace } = getTableCommands();
      runCommand(view, Backspace);

      const info = findCellInfo(view);
      expect(info?.cellType).toBe("table_cell");
      expect(info?.cellText).toBe("b");
    });

    it("does not fire when cursor is not at cell start", () => {
      view = createEditor("| ab | c |\n|---|---|\n| 1 | 2 |\n");
      const abPos = findTextPos(view, "ab");
      setCursor(view, abPos + 1); // cursor after "a", before "b"

      const { Backspace } = getTableCommands();
      const result = runCommand(view, Backspace);

      expect(result).toBe(false); // let default handle it (delete the "a" char)
    });

    it("preserves table structure (no row merging)", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const pos1 = findTextPos(view, "1");
      setCursor(view, pos1);

      const tableBefore = view.state.doc.firstChild!;
      const rowCount = tableBefore.childCount;
      const colCount = tableBefore.firstChild!.childCount;

      const { Backspace } = getTableCommands();
      runCommand(view, Backspace);

      const tableAfter = view.state.doc.firstChild!;
      expect(tableAfter.childCount).toBe(rowCount);
      expect(tableAfter.firstChild!.childCount).toBe(colCount);
    });
  });

  describe("Delete at cell end", () => {
    it("does nothing at last cell of last row", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const pos2 = findTextPos(view, "2");
      setCursor(view, pos2 + 1); // after "2"

      const { Delete } = getTableCommands();
      const result = runCommand(view, Delete);

      expect(result).toBe(true);
      expect(view.state.doc.firstChild!.childCount).toBe(2);
    });

    it("moves to start of next cell in same row", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const aPos = findTextPos(view, "a");
      setCursor(view, aPos + 1); // after "a"

      const { Delete } = getTableCommands();
      runCommand(view, Delete);

      const info = findCellInfo(view);
      expect(info?.cellText).toBe("b");
    });

    it("moves to first cell of next row", () => {
      view = createEditor("| a | b |\n|---|---|\n| 1 | 2 |\n");
      const bPos = findTextPos(view, "b");
      setCursor(view, bPos + 1); // after "b" (last cell of header row)

      const { Delete } = getTableCommands();
      runCommand(view, Delete);

      const info = findCellInfo(view);
      expect(info?.cellType).toBe("table_cell");
      expect(info?.cellText).toBe("1");
    });

    it("does not fire when cursor is not at cell end", () => {
      view = createEditor("| ab | c |\n|---|---|\n| 1 | 2 |\n");
      const abPos = findTextPos(view, "ab");
      setCursor(view, abPos + 1); // between "a" and "b"

      const { Delete } = getTableCommands();
      const result = runCommand(view, Delete);

      expect(result).toBe(false);
    });

    it("returns false outside table", () => {
      view = createEditor("hello\n");
      setCursor(view, 1);
      const { Delete } = getTableCommands();
      expect(runCommand(view, Delete)).toBe(false);
    });
  });

  describe("insertTable and DOM mapping", () => {
    it("insertTable inserts a 3x2 table and moves selection into first header cell", async () => {
      const { insertTable } = await import("../../editor/commands/table");
      view = createEditor("hello\n");
      const result = insertTable(view.state, view.dispatch.bind(view));
      expect(result).toBe(true);
      expect(topLevelTypes(view.state.doc)).toEqual(["paragraph", "table"]);
      expect(view.state.doc.child(1).childCount).toBe(2);
      expect(view.state.doc.child(1).firstChild!.childCount).toBe(3);
      expect(view.state.selection.$from.parent.type.name).toBe("table_cell");
    });

    it("insertTable without dispatch is a no-op and still returns true", async () => {
      const { insertTable } = await import("../../editor/commands/table");
      view = createEditor("hello\n");
      const before = view.state.doc.toJSON();
      const result = insertTable(view.state);
      expect(result).toBe(true);
      expect(view.state.doc.toJSON()).toEqual(before);
    });

    it("table DOM parser keeps align from style and align attribute", () => {
      const wrap = document.createElement("div");
      wrap.innerHTML =
        '<table><tbody><tr><th style="text-align: right">H1</th><th align="center">H2</th></tr><tr><td style="text-align: left">C1</td><td align="right">C2</td></tr></tbody></table>';
      const parsed = PMDOMParser.fromSchema(schema).parse(wrap);
      const table = parsed.firstChild!;

      // Alignment is now stored as an array on the table node
      expect(table.attrs.align).toEqual(["right", "center"]);
      // Individual cells have no align attr
      expect(table.firstChild!.firstChild!.attrs).toEqual({});
      expect(table.child(1).firstChild!.attrs).toEqual({});
    });

    it("table toDOM emits plain td with no style attrs", () => {
      const toDOM = schema.nodes.table_cell.spec.toDOM as (node: PMNode) => readonly unknown[];

      // Cells always render as plain <td> — alignment is handled by the decoration plugin
      const result = toDOM(schema.nodes.table_cell.create(null, schema.text("c")));
      expect(result[0]).toBe("td");
      expect(result.length).toBe(2);
    });
  });

  describe("ArrowUp / ArrowDown — exit table", () => {
    /** Mock endOfTextblock so these exit-path tests stay deterministic. */
    function mockEndOfTextblock(v: EditorView, returnValue = true) {
      v.endOfTextblock = () => returnValue;
    }

    it("ArrowUp in first row first cell exits table (cursor moves before table)", () => {
      const md = "before\n\n| A | B |\n|---|---|\n| 1 | 2 |\n";
      view = createEditor(md);

      // Find position in header cell "A"
      let aPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "A" && aPos === -1) {
          aPos = pos;
        }
      });
      setCursor(view, aPos);
      mockEndOfTextblock(view, true);

      const { ArrowUp } = getTableCommands();
      const result = ArrowUp(view.state, view.dispatch.bind(view), view);
      expect(result).toBe(true);

      // Cursor should now be in the paragraph before the table
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
      expect($from.parent.textContent).toBe("before");
    });

    it("ArrowUp in second row does NOT exit table", () => {
      const md = "before\n\n| A | B |\n|---|---|\n| 1 | 2 |\n";
      view = createEditor(md);

      // Find position in data cell "1"
      let onePos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "1" && onePos === -1) {
          onePos = pos;
        }
      });
      setCursor(view, onePos);
      mockEndOfTextblock(view, true);

      const { ArrowUp } = getTableCommands();
      const result = ArrowUp(view.state, view.dispatch.bind(view), view);
      expect(result).toBe(false);
    });

    it("ArrowDown in last row last cell exits table (cursor moves after table)", () => {
      const md = "| A | B |\n|---|---|\n| 1 | 2 |\n\nafter\n";
      view = createEditor(md);

      // Find position in data cell "2"
      let twoPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "2" && twoPos === -1) {
          twoPos = pos;
        }
      });
      setCursor(view, twoPos);
      mockEndOfTextblock(view, true);

      const { ArrowDown } = getTableCommands();
      const result = ArrowDown(view.state, view.dispatch.bind(view), view);
      expect(result).toBe(true);

      // Cursor should now be in the paragraph after the table
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
      expect($from.parent.textContent).toBe("after");
    });

    it("ArrowDown in first row does NOT exit table", () => {
      const md = "| A | B |\n|---|---|\n| 1 | 2 |\n\nafter\n";
      view = createEditor(md);

      // Find position in header cell "A"
      let aPos = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "A" && aPos === -1) {
          aPos = pos;
        }
      });
      setCursor(view, aPos);
      mockEndOfTextblock(view, true);

      const { ArrowDown } = getTableCommands();
      const result = ArrowDown(view.state, view.dispatch.bind(view), view);
      expect(result).toBe(false);
    });
  });
});

// ========== Code Block Exit Inside Blockquote ==========

describe("Code block exit inside blockquote", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  it("Mod-Enter inside blockquote>code_block creates paragraph inside blockquote", () => {
    // blockquote containing a code block
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.blockquote.create(null, [
        schema.nodes.code.create({ lang: "ts" }, [schema.text('const a = "123";')]),
      ]),
    ]);
    const state = createEditorState(doc);
    const el = document.createElement("div");
    document.body.appendChild(el);
    view = new EditorView(el, { state });

    // Place cursor inside the code block (inside the blockquote)
    setCursor(view, 3); // inside code_block text

    const { "Mod-Enter": modEnter } = getCodeBlockCommands();
    const result = runCommand(view, modEnter);
    expect(result).toBe(true);

    // Should now have blockquote with code_block + paragraph
    const bq = view.state.doc.firstChild!;
    expect(bq.type.name).toBe("blockquote");
    expect(bq.childCount).toBe(2);
    expect(bq.child(0).type.name).toBe("code");
    expect(bq.child(1).type.name).toBe("paragraph");

    // Cursor should be inside the new paragraph
    const { $from } = view.state.selection;
    expect($from.parent.type.name).toBe("paragraph");
  });

  it("ArrowDown at last line of blockquote>code_block exits to next block", () => {
    // blockquote with code_block, followed by a paragraph
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.blockquote.create(null, [
        schema.nodes.code.create({ lang: "ts" }, [schema.text('const a = "123";')]),
      ]),
      schema.nodes.paragraph.create(null, [schema.text("after blockquote")]),
    ]);
    const state = createEditorState(doc);
    const el = document.createElement("div");
    document.body.appendChild(el);
    view = new EditorView(el, { state });

    // Place cursor at the end of the code block text
    let codeEndPos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes("const a") && codeEndPos === -1) {
        codeEndPos = pos + node.nodeSize;
      }
    });
    setCursor(view, codeEndPos);

    const { ArrowDown: arrowDown } = getCodeBlockCommands();
    const result = runCommand(view, arrowDown);
    expect(result).toBe(true);

    // Cursor should now be in the paragraph after the blockquote
    const { $from } = view.state.selection;
    expect($from.parent.type.name).toBe("paragraph");
    expect($from.parent.textContent).toBe("after blockquote");
  });
});

// ========== Gap Cursor Tests ==========

describe("ReactEditorView IME regressions", () => {
  let mounted: MountedReactEditor | null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(() => {
    mounted?.destroy();
    mounted = null;
  });

  async function withWindowErrorCapture(run: (errors: string[]) => Promise<void>): Promise<void> {
    const errors: string[] = [];
    const onWindowError = (event: ErrorEvent) => {
      errors.push(event.message);
      event.preventDefault();
    };
    window.addEventListener("error", onWindowError);
    try {
      await run(errors);
    } finally {
      window.removeEventListener("error", onWindowError);
    }
  }

  it("horizontal_rule node selection survives composition without DOM hierarchy crash", async () => {
    mounted = await createReactEditor("before\n\n---\n\nafter\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      const hrPos = view.state.doc.child(0).nodeSize;
      setNodeSelection(view, hrPos);
      expect(view.state.selection).toBeInstanceOf(NodeSelection);
      expect((view.state.selection as NodeSelection).node.type.name).toBe("thematic_break");

      fireComposition(view, "输入法");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(serializeMarkdown(view.state.doc)).toContain("输入法");
    });
  });

  it("gap cursor composition creates editable paragraph in ReactEditorView", async () => {
    mounted = await createReactEditor("---\n\n```ts\nconst x = 1\n```\n");
    const view = mounted.getView();

    const hrNodeSize = view.state.doc.firstChild!.nodeSize;
    const $pos = view.state.doc.resolve(hrNodeSize);
    view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
    expect(view.state.selection).toBeInstanceOf(GapCursor);

    fireComposition(view, "组词");
    await flushBrowserUpdates();

    expect(topLevelTypes(view.state.doc)).toEqual(["thematic_break", "paragraph", "code"]);
    expect(view.state.doc.child(1).textContent).toContain("组词");
  });

  it("table-adjacent composition does not throw in ReactEditorView", async () => {
    mounted = await createReactEditor("| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      setCursor(view, 3);
      fireComposition(view, "候选");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(serializeMarkdown(view.state.doc)).toContain("候选");
    });
  });

  it("blockquote-adjacent composition does not throw and keeps schema valid", async () => {
    mounted = await createReactEditor("> quoted\n\n---\n\n```ts\nconst x = 1\n```\n\nafter\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      const hrPos = view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize + 1;
      setNodeSelection(view, hrPos);
      fireComposition(view, "候选词");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(serializeMarkdown(view.state.doc)).toContain("候选词");
      expect(() => parseMarkdown(serializeMarkdown(view.state.doc))).not.toThrow();
    });
  });

  it("code_block-adjacent composition does not throw in ReactEditorView", async () => {
    mounted = await createReactEditor("```ts\nconst x = 1\n```\n\n---\n\nafter\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      const hrPos = view.state.doc.child(0).nodeSize + 1;
      setNodeSelection(view, hrPos);
      fireComposition(view, "拼音");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(serializeMarkdown(view.state.doc)).toContain("拼音");
    });
  });

  it("composition over a text selection replaces the selected content", async () => {
    mounted = await createReactEditor("hello world\n");
    const view = mounted.getView();

    selectRange(view, 7, 12);
    fireComposition(view, "世界");
    await flushBrowserUpdates();

    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello 世界");
  });

  it("composition can insert inside a table cell without breaking table structure", async () => {
    mounted = await createReactEditor("| A | B |\n|---|---|\n| 1 | 2 |\n");
    const view = mounted.getView();

    setCursor(view, 3);
    fireComposition(view, "表头");
    await flushBrowserUpdates();

    expect(topLevelTypes(view.state.doc)).toEqual(["table"]);
    expect(serializeMarkdown(view.state.doc)).toContain("表头");
  });

  it("compositionend with empty data does not insert text", async () => {
    mounted = await createReactEditor("```ts\nconst x = 1\n```\n");
    const view = mounted.getView();

    const $pos = view.state.doc.resolve(0);
    view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    await flushBrowserUpdates();

    expect(topLevelTypes(view.state.doc)).toEqual(["paragraph", "code"]);
    expect(view.state.doc.child(0).textContent).toBe("");
  });

  // ---- IME + GapCursor comprehensive tests ----

  it("gap cursor between two code_blocks: IME creates paragraph and inserts text", async () => {
    mounted = await createReactEditor("```ts\nconst a = 1\n```\n\n```ts\nconst b = 2\n```\n");
    const view = mounted.getView();

    // Set gap cursor between the two code blocks
    const gapPos = view.state.doc.child(0).nodeSize;
    const $pos = view.state.doc.resolve(gapPos);
    view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
    expect(view.state.selection).toBeInstanceOf(GapCursor);

    fireComposition(view, "你好");
    await flushBrowserUpdates();

    expect(topLevelTypes(view.state.doc)).toEqual(["code", "paragraph", "code"]);
    expect(view.state.doc.child(1).textContent).toContain("你好");
    expect(view.state.selection).toBeInstanceOf(TextSelection);
  });

  it("gap cursor between blockquote and table: IME creates paragraph", async () => {
    mounted = await createReactEditor("> quoted\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
    const view = mounted.getView();

    const gapPos = view.state.doc.child(0).nodeSize;
    const $pos = view.state.doc.resolve(gapPos);
    view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
    expect(view.state.selection).toBeInstanceOf(GapCursor);

    fireComposition(view, "表格");
    await flushBrowserUpdates();

    const types = topLevelTypes(view.state.doc);
    expect(types[0]).toBe("blockquote");
    expect(types[1]).toBe("paragraph");
    expect(types[2]).toBe("table");
    expect(view.state.doc.child(1).textContent).toContain("表格");
  });

  it("gap cursor at start of doc before code_block: IME creates paragraph", async () => {
    mounted = await createReactEditor("```ts\nconst x = 1\n```\n");
    const view = mounted.getView();

    const $pos = view.state.doc.resolve(0);
    view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
    expect(view.state.selection).toBeInstanceOf(GapCursor);

    fireComposition(view, "开头");
    await flushBrowserUpdates();

    const types = topLevelTypes(view.state.doc);
    expect(types[0]).toBe("paragraph");
    expect(types[1]).toBe("code");
    expect(view.state.doc.child(0).textContent).toContain("开头");
  });

  it("gap cursor at end of doc after blockquote: IME creates paragraph", async () => {
    mounted = await createReactEditor("> last block\n");
    const view = mounted.getView();

    const endPos = view.state.doc.content.size;
    const $pos = view.state.doc.resolve(endPos);
    view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
    expect(view.state.selection).toBeInstanceOf(GapCursor);

    fireComposition(view, "结尾");
    await flushBrowserUpdates();

    const types = topLevelTypes(view.state.doc);
    expect(types[types.length - 1]).toBe("paragraph");
    expect(view.state.doc.child(types.length - 1).textContent).toContain("结尾");
  });

  it("gap cursor compositionstart sets view.input.composing = true", async () => {
    mounted = await createReactEditor("```ts\nconst a = 1\n```\n\n```ts\nconst b = 2\n```\n");
    const view = mounted.getView();

    // Set gap cursor between the two code blocks
    const gapPos = view.state.doc.child(0).nodeSize;
    const $pos = view.state.doc.resolve(gapPos);
    view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
    expect(view.state.selection).toBeInstanceOf(GapCursor);

    const input = getViewInputState(view);

    expect(input.composing).toBe(false);

    // Fire only compositionstart — the flag should be set after paragraph creation
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    expect(input.composing).toBe(true);

    // Fire compositionend — the flag should be cleared
    view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "测试" }));
    expect(input.composing).toBe(false);

    await flushBrowserUpdates();
    expect(view.state.doc.child(1).textContent).toContain("测试");
  });

  it("gap cursor IME does not throw DOM errors in ReactEditorView", async () => {
    mounted = await createReactEditor(
      "> quoted\n\n```ts\ncode\n```\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    );
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      // Gap cursor between blockquote and code_block
      const gapPos = view.state.doc.child(0).nodeSize;
      const $pos = view.state.doc.resolve(gapPos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
      expect(view.state.selection).toBeInstanceOf(GapCursor);

      fireComposition(view, "安全");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(serializeMarkdown(view.state.doc)).toContain("安全");
      // Schema should remain valid
      expect(() => parseMarkdown(serializeMarkdown(view.state.doc))).not.toThrow();
    });
  });

  it("multiple consecutive gap cursor compositions without errors", async () => {
    mounted = await createReactEditor("```ts\na\n```\n\n```ts\nb\n```\n\n```ts\nc\n```\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      // First composition: gap between child 0 and child 1
      const gap1 = view.state.doc.child(0).nodeSize;
      const $pos1 = view.state.doc.resolve(gap1);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos1)));
      fireComposition(view, "第一");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(view.state.doc.child(1).textContent).toContain("第一");

      // After insertion, doc is: code_block, paragraph("第一"), code_block, code_block
      // Now find a gap between the last two code_blocks
      let offset = 0;
      for (let i = 0; i < view.state.doc.childCount - 1; i++) {
        offset += view.state.doc.child(i).nodeSize;
      }
      const $pos2 = view.state.doc.resolve(offset);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos2)));
      fireComposition(view, "第二");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(serializeMarkdown(view.state.doc)).toContain("第一");
      expect(serializeMarkdown(view.state.doc)).toContain("第二");
      expect(() => parseMarkdown(serializeMarkdown(view.state.doc))).not.toThrow();
    });
  });

  it("switching from gap cursor to text cursor then back for compositions", async () => {
    mounted = await createReactEditor("```ts\nconst x = 1\n```\n\n---\n\nafter\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      // 1. Compose at gap cursor between code_block and hr
      const gap1 = view.state.doc.child(0).nodeSize;
      const $gapPos = view.state.doc.resolve(gap1);
      view.dispatch(view.state.tr.setSelection(new GapCursor($gapPos)));
      expect(view.state.selection).toBeInstanceOf(GapCursor);

      fireComposition(view, "间隔");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(view.state.selection).toBeInstanceOf(TextSelection);

      // 2. Now compose in the "after" paragraph (text selection)
      // Find "after" paragraph
      let afterPos = 0;
      for (let i = 0; i < view.state.doc.childCount; i++) {
        const child = view.state.doc.child(i);
        if (child.type.name === "paragraph" && child.textContent.includes("after")) {
          afterPos = afterPos + 1; // inside the paragraph
          break;
        }
        afterPos += child.nodeSize;
      }
      setCursor(view, afterPos);
      fireComposition(view, "文字");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(serializeMarkdown(view.state.doc)).toContain("间隔");
      expect(serializeMarkdown(view.state.doc)).toContain("文字");
    });
  });

  it("gap cursor composition followed by undo does not crash", async () => {
    mounted = await createReactEditor("---\n\n```ts\nconst x = 1\n```\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      const originalTypes = topLevelTypes(view.state.doc);
      expect(originalTypes).toEqual(["thematic_break", "code"]);

      const gapPos = view.state.doc.child(0).nodeSize;
      const $pos = view.state.doc.resolve(gapPos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));

      fireComposition(view, "撤销");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(serializeMarkdown(view.state.doc)).toContain("撤销");
      expect(topLevelTypes(view.state.doc)).toEqual(["thematic_break", "paragraph", "code"]);

      // Undo via history — should remove both the text AND the paragraph
      const { undo } = await import("prosemirror-history");
      undo(view.state, view.dispatch.bind(view));
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(serializeMarkdown(view.state.doc)).not.toContain("撤销");
      // Document structure must be fully restored (no leftover empty paragraph)
      expect(topLevelTypes(view.state.doc)).toEqual(originalTypes);
    });
  });

  it("node selection composition followed by undo restores original document", async () => {
    mounted = await createReactEditor("before\n\n---\n\nafter\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      const originalTypes = topLevelTypes(view.state.doc);
      expect(originalTypes).toEqual(["paragraph", "thematic_break", "paragraph"]);
      const originalMarkdown = serializeMarkdown(view.state.doc);

      // Select the horizontal_rule (child(0) is paragraph, hr starts at its nodeSize)
      const hrPos = view.state.doc.child(0).nodeSize;
      setNodeSelection(view, hrPos);
      expect(view.state.selection).toBeInstanceOf(NodeSelection);
      expect((view.state.selection as NodeSelection).node.type.name).toBe("thematic_break");

      fireComposition(view, "替换");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(serializeMarkdown(view.state.doc)).toContain("替换");
      // hr should be gone — deleteSelection removed it and text was inserted
      // into one of the adjacent paragraphs
      expect(topLevelTypes(view.state.doc)).not.toContain("thematic_break");

      // Undo — the deleteSelection (hr removal) and insertText may be in
      // separate undo groups, so we may need multiple undos to fully restore.
      // Keep undoing until the document stabilizes or we restore the original.
      const { undo } = await import("prosemirror-history");
      const maxUndos = 5;
      for (let i = 0; i < maxUndos; i++) {
        const before = serializeMarkdown(view.state.doc);
        undo(view.state, view.dispatch.bind(view));
        await flushBrowserUpdates();
        expect(errors).toEqual([]);
        if (serializeMarkdown(view.state.doc) === before) break; // no more undo
      }

      // After fully undoing, the original document should be restored
      expect(serializeMarkdown(view.state.doc)).not.toContain("替换");
      expect(topLevelTypes(view.state.doc)).toEqual(originalTypes);
      expect(serializeMarkdown(view.state.doc)).toBe(originalMarkdown);
    });
  });

  it("gap cursor composition undo-redo round-trips correctly", async () => {
    mounted = await createReactEditor("---\n\n```ts\nconst x = 1\n```\n");
    const view = mounted.getView();

    await withWindowErrorCapture(async (errors) => {
      const originalTypes = topLevelTypes(view.state.doc);

      const gapPos = view.state.doc.child(0).nodeSize;
      const $pos = view.state.doc.resolve(gapPos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));

      fireComposition(view, "重做");
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      const afterCompose = serializeMarkdown(view.state.doc);
      expect(afterCompose).toContain("重做");

      // Undo
      const { undo, redo } = await import("prosemirror-history");
      undo(view.state, view.dispatch.bind(view));
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(topLevelTypes(view.state.doc)).toEqual(originalTypes);

      // Redo — should restore the composed text
      redo(view.state, view.dispatch.bind(view));
      await flushBrowserUpdates();

      expect(errors).toEqual([]);
      expect(serializeMarkdown(view.state.doc)).toBe(afterCompose);
      expect(topLevelTypes(view.state.doc)).toEqual(["thematic_break", "paragraph", "code"]);
    });
  });
});

describe("Gap cursor", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  /** Create a doc with specific block-level children. */
  function buildDoc(...children: PMNode[]): PMNode {
    return schema.nodes.doc.create(null, children);
  }

  /** Create a blockquote with a paragraph. */
  function bq(text: string) {
    return schema.nodes.blockquote.create(null, [
      schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []),
    ]);
  }

  /** Create a code block. */
  function code(text: string, lang: string | null = null) {
    return schema.nodes.code.create({ lang: lang }, text ? [schema.text(text)] : []);
  }

  /** Create a paragraph. */
  function para(text: string) {
    return schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []);
  }

  /** Create a horizontal rule. */
  function hr() {
    return schema.nodes.thematic_break.create();
  }

  /** Create a simple 2x2 table. */
  function tbl() {
    const { table: t, table_row: row, table_cell: td } = schema.nodes;
    return t.create(null, [
      row.create(null, [td.createAndFill()!, td.createAndFill()!]),
      row.create(null, [td.createAndFill()!, td.createAndFill()!]),
    ]);
  }

  /** Create an editor from a pre-built doc. */
  function createEditorFromDoc(doc: PMNode): EditorView {
    const state = createEditorState(doc);
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView(el, { state });
  }

  /**
   * Compute the document position right after the top-level node at `index`.
   * This is the gap position between child[index] and child[index+1].
   */
  function gapAfterChild(doc: PMNode, index: number): number {
    let pos = 0;
    for (let i = 0; i <= index; i++) {
      pos += doc.child(i).nodeSize;
    }
    return pos; // position right after child[index], before child[index+1]
  }

  describe("GapCursor.valid()", () => {
    it("is valid between blockquote and code_block", () => {
      const doc = buildDoc(bq("hello"), code("const x = 1;", "js"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid between code_block and code_block", () => {
      const doc = buildDoc(code("a"), code("b"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid between blockquote and blockquote", () => {
      const doc = buildDoc(bq("one"), bq("two"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid between code_block and horizontal_rule", () => {
      const doc = buildDoc(code("x"), hr());
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid between horizontal_rule and code_block", () => {
      const doc = buildDoc(hr(), code("x"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid between blockquote and table", () => {
      const doc = buildDoc(bq("text"), tbl());
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid between code_block and table", () => {
      const doc = buildDoc(code("x"), tbl());
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid at start of doc before code_block", () => {
      const doc = buildDoc(code("x"), para("after"));
      const $pos = doc.resolve(0);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid at start of doc before blockquote", () => {
      const doc = buildDoc(bq("quoted"), para("after"));
      const $pos = doc.resolve(0);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid at end of doc after code_block", () => {
      const doc = buildDoc(para("before"), code("x"));
      const pos = doc.content.size;
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is valid at end of doc after blockquote", () => {
      const doc = buildDoc(para("before"), bq("quoted"));
      const pos = doc.content.size;
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(true);
    });

    it("is NOT valid between two paragraphs", () => {
      const doc = buildDoc(para("one"), para("two"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(false);
    });

    it("is NOT valid between heading and paragraph", () => {
      const heading = schema.nodes.heading.create({ depth: 2 }, [schema.text("Title")]);
      const doc = buildDoc(heading, para("text"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(false);
    });

    it("is NOT valid between paragraph and code_block (paragraph side open)", () => {
      const doc = buildDoc(para("text"), code("x"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      expect(GC.valid($pos)).toBe(false);
    });

    it("is NOT valid at start of doc before paragraph", () => {
      const doc = buildDoc(para("hello"));
      const $pos = doc.resolve(0);
      expect(GC.valid($pos)).toBe(false);
    });

    it("is NOT valid inside table (between rows)", () => {
      const { table: t, table_row: row, table_cell: td } = schema.nodes;
      const headerRow = row.create(null, [
        td.create(null, [schema.text("A")]),
        td.create(null, [schema.text("B")]),
      ]);
      const dataRow = row.create(null, [
        td.create(null, [schema.text("1")]),
        td.create(null, [schema.text("2")]),
      ]);
      const table = t.create(null, [headerRow, dataRow]);
      const doc = buildDoc(table);
      // Position between the two rows (after header row, before data row)
      // table open (1) + headerRow nodeSize
      const posAfterHeaderRow = 1 + headerRow.nodeSize;
      const $pos = doc.resolve(posAfterHeaderRow);
      expect($pos.parent.type.name).toBe("table");
      expect(GC.valid($pos)).toBe(false);
    });

    it("is NOT valid inside table_row (between cells)", () => {
      const { table: t, table_row: row, table_cell: th } = schema.nodes;
      const cell1 = th.create(null, [schema.text("A")]);
      const cell2 = th.create(null, [schema.text("B")]);
      const headerRow = row.create(null, [cell1, cell2]);
      const dataRow = row.create(null, [
        schema.nodes.table_cell.create(null, [schema.text("1")]),
        schema.nodes.table_cell.create(null, [schema.text("2")]),
      ]);
      const table = t.create(null, [headerRow, dataRow]);
      const doc = buildDoc(table);
      // Position between two cells in header row
      // table open (1) + row open (1) + cell1 nodeSize
      const posBetweenCells = 1 + 1 + cell1.nodeSize;
      const $pos = doc.resolve(posBetweenCells);
      expect($pos.parent.type.name).toBe("table_row");
      expect(GC.valid($pos)).toBe(false);
    });
  });

  describe("GapCursor.findGapCursorFrom()", () => {
    it("finds gap position when searching forward from after blockquote", () => {
      const doc = buildDoc(bq("hello"), code("x"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      const found = GC.findGapCursorFrom!($pos, 1);
      expect(found).not.toBeNull();
      expect(found!.pos).toBe(pos);
    });

    it("finds gap position when searching backward from before code_block", () => {
      const doc = buildDoc(bq("hello"), code("x"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      const found = GC.findGapCursorFrom!($pos, -1);
      expect(found).not.toBeNull();
      expect(found!.pos).toBe(pos);
    });

    it("returns null when no gap cursor exists (between paragraphs)", () => {
      const doc = buildDoc(para("one"), para("two"));
      const pos = gapAfterChild(doc, 0);
      const $pos = doc.resolve(pos);
      const found = GC.findGapCursorFrom!($pos, 1, true);
      expect(found).toBeNull();
    });
  });

  describe("paragraph insertion at gap cursor via Enter", () => {
    it("inserts paragraph between blockquote and code_block", () => {
      const doc = buildDoc(bq("hello"), code("const x = 1;", "js"));
      view = createEditorFromDoc(doc);

      // Set gap cursor
      const pos = gapAfterChild(doc, 0);
      const $pos = view.state.doc.resolve(pos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
      expect(view.state.selection).toBeInstanceOf(GapCursor);

      // Simulate Enter via createParagraphNear (part of baseKeymap)
      const result = createParagraphNear(view.state, view.dispatch.bind(view));
      expect(result).toBe(true);

      // Should now have: blockquote, paragraph, code_block
      const types = topLevelTypes(view.state.doc);
      expect(types).toEqual(["blockquote", "paragraph", "code"]);

      // Cursor should be inside the new paragraph
      const { $from } = view.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
      expect($from.parent.content.size).toBe(0);
    });

    it("inserts paragraph between two code_blocks", () => {
      const doc = buildDoc(code("a"), code("b"));
      view = createEditorFromDoc(doc);

      const pos = gapAfterChild(doc, 0);
      const $pos = view.state.doc.resolve(pos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));

      createParagraphNear(view.state, view.dispatch.bind(view));

      const types = topLevelTypes(view.state.doc);
      expect(types).toEqual(["code", "paragraph", "code"]);
    });

    it("inserts paragraph between code_block and horizontal_rule", () => {
      const doc = buildDoc(code("x"), hr());
      view = createEditorFromDoc(doc);

      const pos = gapAfterChild(doc, 0);
      const $pos = view.state.doc.resolve(pos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));

      createParagraphNear(view.state, view.dispatch.bind(view));

      const types = topLevelTypes(view.state.doc);
      expect(types).toEqual(["code", "paragraph", "thematic_break"]);
    });

    it("inserts paragraph at start of doc before code_block", () => {
      const doc = buildDoc(code("x"));
      view = createEditorFromDoc(doc);

      const $pos = view.state.doc.resolve(0);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));

      createParagraphNear(view.state, view.dispatch.bind(view));

      const types = topLevelTypes(view.state.doc);
      expect(types[0]).toBe("paragraph");
      expect(types[1]).toBe("code");
    });

    it("inserts paragraph at end of doc after code_block", () => {
      const doc = buildDoc(code("x"));
      view = createEditorFromDoc(doc);

      const endPos = view.state.doc.content.size;
      const $pos = view.state.doc.resolve(endPos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));

      createParagraphNear(view.state, view.dispatch.bind(view));

      const types = topLevelTypes(view.state.doc);
      expect(types[0]).toBe("code");
      expect(types[1]).toBe("paragraph");
    });
  });

  describe("gap cursor preserves document integrity", () => {
    it("setting and clearing gap cursor does not modify document", () => {
      const doc = buildDoc(bq("hello"), code("x"));
      view = createEditorFromDoc(doc);

      const docBefore = view.state.doc.toJSON();

      // Set gap cursor
      const pos = gapAfterChild(view.state.doc, 0);
      const $pos = view.state.doc.resolve(pos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));

      // Move to text selection
      setCursor(view, 2); // inside blockquote

      // Document should be unchanged
      expect(view.state.doc.toJSON()).toEqual(docBefore);
    });

    it("gap cursor serializes back to identical markdown", () => {
      const md = "> quoted\n\n```js\nconst x = 1;\n```\n";
      view = createEditor(md);

      // Set gap cursor between blockquote and code_block
      const pos = gapAfterChild(view.state.doc, 0);
      const $pos = view.state.doc.resolve(pos);
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));

      // Serialize — should be unchanged
      const serialized = serializeMarkdown(view.state.doc);
      expect(serialized.trim()).toBe(md.trim());
    });
  });
});

describe("Hard break interactions", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  function getShiftEnterCommand() {
    return hardBreakExt.keymap!(schema)["Shift-Enter"]!;
  }

  it("Shift-Enter inserts hard break in paragraph", () => {
    view = createEditor("hello world\n");
    setCursor(view, 6);
    expect(runCommand(view, getShiftEnterCommand())).toBe(true);
    expect(
      view.state.doc.firstChild!.content.content.some((child) => child.type.name === "break"),
    ).toBe(true);
    expect(serializeMarkdown(view.state.doc)).toContain("\\\n");
  });

  it("Shift-Enter in code block exits code block before hard-break fallback", () => {
    view = createEditor("```js\nconst x = 1;\n```\n");
    setCursor(view, 4);
    expect(runCommand(view, getShiftEnterCommand())).toBe(true);
    expect(view.state.doc.firstChild!.type.name).toBe("code");
    expect(view.state.doc.child(1).type.name).toBe("paragraph");
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("hard break parseDOM and toDOM are wired", () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = "<p>a<br>b</p>";
    const parsed = PMDOMParser.fromSchema(schema).parse(wrap);
    const paragraph = parsed.firstChild!;
    expect(paragraph.content.content.some((child: PMNode) => child.type.name === "break")).toBe(
      true,
    );

    const toDOM = schema.nodes.break.spec.toDOM as unknown as (node: PMNode) => readonly unknown[];
    expect(toDOM(schema.nodes.break.create())).toEqual(["br"]);
  });
});

// ========== Clipboard Text Serialization Tests ==========

describe("Clipboard text serialization (text/plain as Markdown)", () => {
  let view: EditorView;

  afterEach(() => {
    if (view) destroyEditor(view);
  });

  function createClipboardTestEditor(doc: PMNode): EditorView {
    const state = createEditorState(doc);
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView(el, { state });
  }

  function createClipboardEvent(type: "copy" | "paste", data: DataTransfer): ClipboardEvent {
    const event = new ClipboardEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    return event;
  }

  /** Get the text/plain clipboard output for the current selection. */
  function getClipboardText(v: EditorView): string {
    const slice = v.state.selection.content();
    return v.someProp("clipboardTextSerializer", (f) => f(slice, v)) ?? "";
  }

  describe("formatted text produces Markdown", () => {
    it("bold text serializes with ** markers", () => {
      view = createEditor("hello **world** end\n");
      // Select "hello **world** end" (full paragraph)
      selectRange(view, 1, view.state.doc.firstChild!.nodeSize - 1);
      expect(getClipboardText(view)).toBe("hello **world** end");
    });

    it("italic text serializes with * markers", () => {
      view = createEditor("hello *world* end\n");
      selectRange(view, 1, view.state.doc.firstChild!.nodeSize - 1);
      expect(getClipboardText(view)).toBe("hello *world* end");
    });

    it("inline code serializes with backticks", () => {
      view = createEditor("use `code` here\n");
      selectRange(view, 1, view.state.doc.firstChild!.nodeSize - 1);
      expect(getClipboardText(view)).toBe("use `code` here");
    });

    it("strikethrough serializes with ~~ markers", () => {
      view = createEditor("hello ~~deleted~~ end\n");
      selectRange(view, 1, view.state.doc.firstChild!.nodeSize - 1);
      expect(getClipboardText(view)).toBe("hello ~~deleted~~ end");
    });

    it("link serializes with [text](url)", () => {
      view = createEditor("click [here](https://example.com) please\n");
      selectRange(view, 1, view.state.doc.firstChild!.nodeSize - 1);
      expect(getClipboardText(view)).toBe("click [here](https://example.com) please");
    });

    it("node-selected image copies the same clipboard content as range-selected image", () => {
      const image = schema.nodes.image.create({ url: "image.png", alt: "alt", title: null });
      const doc = schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [image]),
        schema.nodes.paragraph.create(),
      ]);
      view = createClipboardTestEditor(doc);

      const img = view.dom.querySelector("img");
      expect(img).toBeInstanceOf(HTMLImageElement);
      const imageElement = img as HTMLImageElement;
      imageElement.style.width = "40px";
      imageElement.style.height = "20px";
      const { x, y } = centerOf(imageElement);
      imageElement.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: y,
        }),
      );
      imageElement.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          clientX: x,
          clientY: y,
        }),
      );
      expect(view.state.selection).toBeInstanceOf(NodeSelection);
      expect((view.state.selection as NodeSelection).node.type.name).toBe("image");

      const nodeSelectionClipboard = new DataTransfer();
      view.dom.dispatchEvent(createClipboardEvent("copy", nodeSelectionClipboard));

      selectRange(view, 1, 2);
      const rangeSelectionClipboard = new DataTransfer();
      view.dom.dispatchEvent(createClipboardEvent("copy", rangeSelectionClipboard));

      expect(nodeSelectionClipboard.getData("text/plain")).toBe("![alt](image.png)");
      expect(nodeSelectionClipboard.getData("text/plain")).toBe(
        rangeSelectionClipboard.getData("text/plain"),
      );
      expect(nodeSelectionClipboard.getData("text/html")).toBe(
        rangeSelectionClipboard.getData("text/html"),
      );
      expect(nodeSelectionClipboard.getData("text/html")).toContain('data-pm-slice="1 1');

      setCursor(view, 4);
      view.dom.dispatchEvent(createClipboardEvent("paste", nodeSelectionClipboard));

      const targetParagraph = view.state.doc.child(1);
      expect(targetParagraph.childCount).toBe(1);
      expect(targetParagraph.firstChild?.type.name).toBe("image");
      expect(targetParagraph.textContent).toBe("");
      expect(view.dom.querySelectorAll("p")[1]?.classList.contains("image-paragraph")).toBe(true);
    });

    it("heading serializes with # prefix", () => {
      view = createEditor("## My Heading\n");
      selectRange(view, 1, view.state.doc.firstChild!.nodeSize - 1);
      expect(getClipboardText(view)).toBe("## My Heading");
    });
  });

  describe("code block clipboard behavior", () => {
    it("selection inside code block returns raw code (no fences)", () => {
      view = createEditor("```js\nconst x = 1;\n```\n");
      // Select all text inside the code block
      const codeBlock = view.state.doc.firstChild!;
      selectRange(view, 1, 1 + codeBlock.textContent.length);
      const text = getClipboardText(view);
      expect(text).toBe("const x = 1;");
      expect(text).not.toContain("```");
    });

    it("partial selection inside code block returns raw code (no fences)", () => {
      view = createEditor("```js\nconst x = 1;\nconst y = 2;\n```\n");
      // Select only "const x = 1;"
      selectRange(view, 1, 13);
      const text = getClipboardText(view);
      expect(text).toBe("const x = 1;");
      expect(text).not.toContain("```");
    });

    it("whole code block selected as block returns fenced markdown", () => {
      view = createEditor("before\n\n```js\nconst x = 1;\n```\n\nafter\n");
      // Select the entire code block (from before to after)
      const firstNodeSize = view.state.doc.firstChild!.nodeSize;
      const codeBlockSize = view.state.doc.child(1).nodeSize;
      selectRange(view, firstNodeSize, firstNodeSize + codeBlockSize);
      const text = getClipboardText(view);
      expect(text).toContain("```js");
      expect(text).toContain("const x = 1;");
      expect(text).toContain("```");
    });
  });

  describe("block-level selections", () => {
    it("blockquote serializes with > prefix", () => {
      view = createEditor("> quoted text\n");
      selectRange(view, 0, view.state.doc.content.size);
      const text = getClipboardText(view);
      expect(text).toContain("> quoted text");
    });

    it("bullet list serializes with - prefix", () => {
      view = createEditor("- item one\n- item two\n");
      selectRange(view, 0, view.state.doc.content.size);
      const text = getClipboardText(view);
      expect(text).toContain("- item one");
      expect(text).toContain("- item two");
    });

    it("ordered list serializes with number prefix", () => {
      view = createEditor("1. first\n2. second\n");
      selectRange(view, 0, view.state.doc.content.size);
      const text = getClipboardText(view);
      expect(text).toContain("1. first");
      expect(text).toContain("2. second");
    });

    it("table serializes as markdown table", () => {
      view = createEditor("| A | B |\n|---|---|\n| 1 | 2 |\n");
      selectRange(view, 0, view.state.doc.content.size);
      const text = getClipboardText(view);
      expect(text).toContain("| A");
      expect(text).toContain("| 1");
      expect(text).toContain("| -");
    });

    it("horizontal rule serializes as ---", () => {
      view = createEditor("before\n\n---\n\nafter\n");
      selectRange(view, 0, view.state.doc.content.size);
      const text = getClipboardText(view);
      expect(text).toContain("before");
      expect(text).toContain("---");
      expect(text).toContain("after");
    });
  });

  describe("multi-block selections", () => {
    it("cross-block selection preserves all markdown formatting", () => {
      view = createEditor("## Heading\n\nA **bold** paragraph.\n\n- list item\n");
      selectRange(view, 0, view.state.doc.content.size);
      const text = getClipboardText(view);
      expect(text).toContain("## Heading");
      expect(text).toContain("**bold**");
      expect(text).toContain("- list item");
    });

    it("selection spanning blockquote and code block", () => {
      view = createEditor("> quote\n\n```js\ncode();\n```\n");
      selectRange(view, 0, view.state.doc.content.size);
      const text = getClipboardText(view);
      expect(text).toContain("> quote");
      expect(text).toContain("```js");
      expect(text).toContain("code();");
    });
  });

  describe("plain text without formatting", () => {
    it("plain paragraph returns plain text (no markdown artifacts)", () => {
      view = createEditor("hello world\n");
      selectRange(view, 1, 12);
      expect(getClipboardText(view)).toBe("hello world");
    });
  });
});
