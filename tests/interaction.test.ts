import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, afterEach, beforeEach } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { cdp } from "vite-plus/test/browser/context";
import {
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEffect,
} from "@handlewithcare/react-prosemirror";
import { GapCursor } from "prosemirror-gapcursor";
import type { Node as PMNode, ResolvedPos } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { createDefaultPlugins } from "../src/editor/plugins";
import { parseMarkdown, schema, serializeMarkdown } from "../src/markdown";

type MountedReactEditor = {
  root: Root;
  container: HTMLDivElement;
  getView: () => EditorView;
  destroy: () => void;
};

type ViewInputState = {
  composing: boolean;
  compositionNode?: Node | null;
};

const GC = GapCursor as unknown as {
  valid: (pos: ResolvedPos) => boolean;
};

function docFromContent(content?: string | PMNode): PMNode {
  if (typeof content === "string") return parseMarkdown(content);
  if (content) return content;
  return schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
}

function createEditorState(doc: PMNode): EditorState {
  return EditorState.create({
    doc,
    schema,
    plugins: createDefaultPlugins(),
  });
}

function createReactEditorState(doc: PMNode): EditorState {
  return EditorState.create({
    doc,
    schema,
    plugins: [reactKeys(), ...createDefaultPlugins()],
  });
}

function createEditor(content?: string | PMNode): EditorView {
  const doc = docFromContent(content);
  const state = createEditorState(doc);
  const el = document.createElement("div");
  el.style.whiteSpace = "pre-wrap";
  document.body.appendChild(el);
  const view = new EditorView(el, { state });
  view.dom.style.whiteSpace = "pre-wrap";
  return view;
}

function destroyEditor(view: EditorView): void {
  view.destroy();
  view.dom.parentNode?.removeChild(view.dom);
}

async function createReactEditor(
  content?: string | PMNode,
  ariaLabel = "React editor",
): Promise<MountedReactEditor> {
  const doc = docFromContent(content);
  const initialState = createReactEditorState(doc);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let currentView: EditorView | null = null;
  let resolveView!: (view: EditorView) => void;
  const mounted = new Promise<EditorView>((resolve) => {
    resolveView = resolve;
  });

  function ViewCapture() {
    useEditorEffect((view) => {
      currentView = view;
      resolveView(view);
    });
    return null;
  }

  function Harness() {
    const [editorState, setEditorState] = useState(initialState);
    return createElement(
      ProseMirror,
      {
        state: editorState,
        dispatchTransaction: (tr: Transaction) => {
          setEditorState((s) => s.apply(tr));
        },
      },
      createElement(ViewCapture),
      createElement(ProseMirrorDoc, {
        role: "textbox",
        "aria-label": ariaLabel,
        style: { whiteSpace: "pre-wrap" },
      }),
    );
  }

  flushSync(() => {
    root.render(createElement(Harness));
  });
  await mounted;

  return {
    root,
    container,
    getView: () => {
      if (!currentView) throw new Error("React editor view not mounted");
      return currentView;
    },
    destroy: () => {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function getViewInputState(view: EditorView): ViewInputState {
  return (view as EditorView & { input: ViewInputState }).input;
}

async function flushBrowserUpdates(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let cdpSession: ReturnType<typeof cdp> | null = null;
function cdpSessionOnce(): ReturnType<typeof cdp> {
  cdpSession ??= cdp();
  return cdpSession;
}

async function fireComposition(view: EditorView, data = "测试"): Promise<void> {
  const session = cdpSessionOnce();
  view.focus();
  syncDomSelectionToState(view);
  await flushBrowserUpdates();

  if (data.length > 0) {
    for (let i = 1; i <= data.length; i++) {
      await session.send("Input.imeSetComposition", {
        text: data.slice(0, i),
        selectionStart: i,
        selectionEnd: i,
      });
      await flushBrowserUpdates();
    }
    await session.send("Input.insertText", { text: data });
  } else {
    await session.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
  }
  await flushBrowserUpdates();
  await flushBrowserUpdates();
}

function syncDomSelectionToState(view: EditorView): void {
  const { selection } = view.state;
  const docView = (view as EditorView & { docView: { setSelection?: unknown } | null }).docView;
  if (!docView || typeof docView.setSelection !== "function") return;
  const domObserver = (
    view as EditorView & {
      domObserver: {
        disconnectSelection: () => void;
        setCurSelection: () => void;
        connectSelection: () => void;
      };
    }
  ).domObserver;
  domObserver.disconnectSelection();
  try {
    (docView.setSelection as (a: number, h: number, v: EditorView, force: boolean) => void)(
      selection.anchor,
      selection.head,
      view,
      true,
    );
  } catch {
    // Node and gap selections are normalized by the composition handler itself.
  } finally {
    domObserver.setCurSelection();
    domObserver.connectSelection();
  }
}

function setCursor(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

function selectRange(view: EditorView, from: number, to: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

function setNodeSelection(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
}

function topLevelTypes(doc: PMNode): string[] {
  const types: string[] = [];
  doc.forEach((node) => types.push(node.type.name));
  return types;
}

function collectMarks(doc: PMNode): Set<string> {
  const marks = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks) marks.add(mark.type.name);
  });
  return marks;
}

function validatePMNode(node: PMNode): string[] {
  const errors: string[] = [];
  node.descendants((child, _pos, parent) => {
    if (!schema.nodes[child.type.name]) errors.push(`Unknown node type: ${child.type.name}`);
    for (const mark of child.marks) {
      if (!schema.marks[mark.type.name]) errors.push(`Unknown mark type: ${mark.type.name}`);
    }
    if (parent && !parent.type.validContent(parent.content)) {
      errors.push(`${parent.type.name} has invalid content`);
    }
  });
  if (!node.type.validContent(node.content)) errors.push(`${node.type.name} has invalid content`);
  return errors;
}

function domCaret(): { node: Node | null; offset: number } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { node: null, offset: -1 };
  return { node: sel.anchorNode, offset: sel.anchorOffset };
}

async function captureBrowserErrors(run: (errors: string[]) => Promise<void>): Promise<void> {
  const errors: string[] = [];
  const originalConsoleError = console.error;
  const onWindowError = (event: ErrorEvent) => {
    errors.push(`window.error ${event.message}`);
    event.preventDefault();
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    errors.push(`window.unhandledrejection ${String(event.reason)}`);
    event.preventDefault();
  };

  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
    originalConsoleError.apply(console, args);
  };
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  try {
    await run(errors);
  } finally {
    console.error = originalConsoleError;
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }
}

function filteredErrors(errors: string[]): string[] {
  return errors.filter(
    (msg) => !msg.includes("vitest") && !msg.includes("React") && !msg.includes("[HMR]"),
  );
}

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

const STARTING_DOCS = [
  "# Hello World\n\nSome **bold** and *italic* text.\n\n- Item 1\n- Item 2\n",
  "| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n",
  "1. First item\n2. Second item\n\n---\n\nEnd.\n",
  "- Outer 1\n  - Inner 1\n  - Inner 2\n- Outer 2\n",
  "> Quote\n\n```ts\nconst x = 1\n```\n\n---\n\nTail paragraph\n",
  "plain before\n\n![alt](/image.svg)\n\nplain after\n",
  "这是**粗体**和==高亮。==文本\n\n- [x] done\n- [ ] todo\n",
  "```js\nconsole.log('a')\n```\n\n```js\nconsole.log('b')\n```\n",
] as const;

const KEYBOARD_FUZZ_SEEDS = [7, 97] as const;
const KEYBOARD_FUZZ_STEPS = 44;
const IME_FUZZ_SEEDS = [99123, 88001, 77009] as const;
const IME_FUZZ_STEPS = 40;

const TEXT_INPUTS = [
  "plain",
  " world",
  "# ",
  "- ",
  "* ",
  "1. ",
  "3. ",
  "> ",
  "**bold** ",
  "*em* ",
  "`code` ",
  "~~strike~~ ",
  "==mark== ",
  "```js{Enter}",
] as const;
const SHORTCUTS = [
  "{Control>}b{/Control}",
  "{Control>}i{/Control}",
  "{Control>}a{/Control}",
  "{Control>}z{/Control}",
  "{Control>}{Shift>}z{/Shift}{/Control}",
  "{Enter}",
  "{Shift>}{Enter}{/Shift}",
  "{Backspace}",
  "{Delete}",
  "{Tab}",
  "{Shift>}{Tab}{/Shift}",
  "{ArrowLeft}",
  "{ArrowRight}",
  "{ArrowUp}",
  "{ArrowDown}",
] as const;

function randomTextSelection(view: EditorView, rng: Rng): TextSelection | null {
  const candidates: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text && node.text.length > 0) {
      for (let i = 0; i < node.text.length; i++) candidates.push(pos + i);
    }
  });
  if (candidates.length === 0) return null;

  const anchor = rng.pick(candidates);
  const head = rng.chance(0.5) ? anchor : rng.pick(candidates);
  try {
    return TextSelection.create(view.state.doc, Math.min(anchor, head), Math.max(anchor, head));
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function setRandomTextSelection(view: EditorView, rng: Rng): string {
  const selection = randomTextSelection(view, rng);
  if (!selection) return "selection:none";
  view.dispatch(view.state.tr.setSelection(selection));
  return `selection:${selection.from}-${selection.to}`;
}

function findTopLevelNodePosByType(view: EditorView, typeName: string): number | null {
  let pos = 0;
  for (let i = 0; i < view.state.doc.childCount; i++) {
    const child = view.state.doc.child(i);
    if (child.type.name === typeName) return pos;
    pos += child.nodeSize;
  }
  return null;
}

function canSelectNodeAt(view: EditorView, pos: number): boolean {
  try {
    return view.state.doc.resolve(pos).nodeAfter != null;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

function setRandomGapSelection(view: EditorView): string | null {
  for (let i = 0, pos = 0; i < view.state.doc.childCount - 1; i++) {
    pos += view.state.doc.child(i).nodeSize;
    const $pos = view.state.doc.resolve(pos);
    if (GC.valid($pos)) {
      view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
      return `gap:${pos}`;
    }
  }
  return null;
}

function setRandomNodeSelection(view: EditorView, rng: Rng): string | null {
  for (const typeName of rng.chance(0.5)
    ? ["thematic_break", "image", "code", "blockquote", "table"]
    : ["image", "thematic_break", "table", "blockquote", "code"]) {
    const pos = findTopLevelNodePosByType(view, typeName);
    if (pos != null && canSelectNodeAt(view, pos)) {
      try {
        setNodeSelection(view, pos);
        return `node:${typeName}@${pos}`;
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
  }
  return null;
}

function setRandomInteractionSelection(view: EditorView, rng: Rng): string {
  switch (rng.int(4)) {
    case 0:
      return setRandomGapSelection(view) ?? setRandomTextSelection(view, rng);
    case 1:
      return setRandomNodeSelection(view, rng) ?? setRandomTextSelection(view, rng);
    default:
      return setRandomTextSelection(view, rng);
  }
}

async function realBlurFocusOp(view: EditorView): Promise<string> {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "blur target";
  document.body.appendChild(button);
  try {
    await userEvent.click(button);
    await flushBrowserUpdates();
    await userEvent.click(view.dom as HTMLElement);
    await flushBrowserUpdates();
  } finally {
    button.remove();
  }
  return "blur-focus";
}

async function browserCompositionOp(view: EditorView, rng: Rng): Promise<string> {
  const compositionText = rng.pick(["输入", "测试", "候选", "拼音", "かな", "한글"]);
  const hrPos = findTopLevelNodePosByType(view, "thematic_break");
  let selectionOp: string;

  if (hrPos != null && canSelectNodeAt(view, hrPos) && rng.chance(0.5)) {
    setNodeSelection(view, hrPos);
    selectionOp = `node:thematic_break@${hrPos}`;
  } else if (rng.chance(0.4)) {
    selectionOp = setRandomGapSelection(view) ?? setRandomTextSelection(view, rng);
  } else {
    selectionOp = setRandomInteractionSelection(view, rng);
  }

  view.focus();
  syncDomSelectionToState(view);
  await flushBrowserUpdates();

  for (let i = 1; i <= compositionText.length; i++) {
    await cdpSessionOnce().send("Input.imeSetComposition", {
      text: compositionText.slice(0, i),
      selectionStart: i,
      selectionEnd: i,
    });
    await flushBrowserUpdates();
  }

  const lifecycleOps: string[] = [];
  if (rng.chance(0.2)) {
    lifecycleOps.push(await realBlurFocusOp(view));
  }

  await cdpSessionOnce().send("Input.insertText", { text: compositionText });
  await flushBrowserUpdates();
  await flushBrowserUpdates();

  if (rng.chance(0.15)) {
    await userEvent.keyboard("{Control>}z{/Control}");
    lifecycleOps.push("undo");
    await flushBrowserUpdates();
    if (rng.chance(0.5)) {
      await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
      lifecycleOps.push("redo");
      await flushBrowserUpdates();
    }
  }

  return `composition:${compositionText}:${selectionOp}${lifecycleOps.length ? `:${lifecycleOps.join(",")}` : ""}`;
}

async function realKeyboardOp(view: EditorView, rng: Rng): Promise<string> {
  const selectionOp = setRandomInteractionSelection(view, rng);
  view.focus();
  const input = rng.chance(0.6) ? rng.pick(TEXT_INPUTS) : rng.pick(SHORTCUTS);
  await userEvent.keyboard(input);
  await flushBrowserUpdates();
  return `${selectionOp}; keyboard:${input}`;
}

async function realBrowserOp(view: EditorView, rng: Rng): Promise<string> {
  switch (rng.int(5)) {
    case 0:
    case 1:
    case 2:
      return realKeyboardOp(view, rng);
    case 3:
      return realBlurFocusOp(view);
    default: {
      await userEvent.click(view.dom as HTMLElement);
      await flushBrowserUpdates();
      return "click-editor";
    }
  }
}

function formatFuzzContext(seed: number, initialMarkdown: string, ops: string[], view: EditorView) {
  return [
    `seed=${seed}`,
    "Initial Markdown:",
    "```md",
    initialMarkdown,
    "```",
    "Operations:",
    "```text",
    ops.join("\n"),
    "```",
    "Current Markdown:",
    "```md",
    serializeMarkdown(view.state.doc),
    "```",
  ].join("\n");
}

describe("Real browser typing", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    if (view) destroyEditor(view);
    view = null;
  });

  it("# + space converts the current paragraph to a heading", async () => {
    view = createEditor("");
    setCursor(view, 1);
    view.focus();

    await userEvent.keyboard("# ");
    await flushBrowserUpdates();

    expect(view.state.doc.firstChild!.type.name).toBe("heading");
    expect(view.state.doc.firstChild!.attrs.depth).toBe(1);
  });

  it("- + space creates a bullet list through the native input pipeline", async () => {
    view = createEditor("");
    setCursor(view, 1);
    view.focus();

    await userEvent.keyboard("- ");
    await flushBrowserUpdates();

    expect(view.state.doc.firstChild!.type.name).toBe("list");
    expect(view.state.doc.firstChild!.attrs.ordered).toBe(false);
  });

  it("typed inline markup creates the corresponding mark", async () => {
    view = createEditor("");
    setCursor(view, 1);
    view.focus();

    await userEvent.keyboard("**bold** ");
    await flushBrowserUpdates();

    expect(collectMarks(view.state.doc).has("strong")).toBe(true);
    expect(view.state.doc.textContent).toBe("bold ");
    expect(serializeMarkdown(view.state.doc)).toContain("**bold**");
  });

  it("typed code fence plus Enter creates a code block", async () => {
    view = createEditor("");
    setCursor(view, 1);
    view.focus();

    await userEvent.keyboard("```ts{Enter}");
    await flushBrowserUpdates();

    expect(view.state.doc.firstChild!.type.name).toBe("code");
    expect(view.state.doc.firstChild!.attrs.lang).toBe("ts");
  });

  it("undo and redo round-trip real typed text", async () => {
    view = createEditor("hello\n");
    setCursor(view, 6);
    view.focus();

    await userEvent.keyboard(" world");
    await flushBrowserUpdates();
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello world");

    await userEvent.keyboard("{Control>}z{/Control}");
    await flushBrowserUpdates();
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello");

    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await flushBrowserUpdates();
    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello world");
  });
});

describe("Real keyboard shortcuts", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    if (view) destroyEditor(view);
    view = null;
  });

  it("Mod-b applies strong to the selected text", async () => {
    view = createEditor("hello world\n");
    selectRange(view, 7, 12);
    view.focus();

    await userEvent.keyboard("{Control>}b{/Control}");
    await flushBrowserUpdates();

    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello **world**");
  });
});

describe("ReactEditorView IME behavior", () => {
  let mounted: MountedReactEditor | null = null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(() => {
    mounted?.destroy();
    mounted = null;
  });

  it("keeps the DOM caret beside text after a mid-line IME commit", async () => {
    mounted = await createReactEditor("the quick brown fox\n");
    const view = mounted.getView();
    view.focus();
    setCursor(view, 11);
    await flushBrowserUpdates();

    await fireComposition(view, "测");

    expect(view.state.selection.from).toBe(12);
    const caret = domCaret();
    expect(caret.node?.nodeType).toBe(Node.TEXT_NODE);
    expect(caret.node?.textContent).toContain("测");
    expect(caret.offset).toBe(11);
  });

  it("keeps the DOM caret stable across consecutive mid-line IME commits", async () => {
    mounted = await createReactEditor("the quick brown fox\n");
    const view = mounted.getView();
    view.focus();
    setCursor(view, 11);
    await flushBrowserUpdates();

    await fireComposition(view, "测");
    await fireComposition(view, "试");

    expect(view.state.doc.textContent).toBe("the quick 测试brown fox");
    expect(view.state.selection.from).toBe(13);
    const caret = domCaret();
    expect(caret.node?.nodeType).toBe(Node.TEXT_NODE);
    expect(caret.node?.textContent).toContain("测试");
    expect(caret.offset).toBe(12);
  });

  it("horizontal_rule node selection survives composition without DOM hierarchy errors", async () => {
    mounted = await createReactEditor("before\n\n---\n\nafter\n");
    const view = mounted.getView();

    await captureBrowserErrors(async (errors) => {
      const hrPos = view.state.doc.child(0).nodeSize;
      setNodeSelection(view, hrPos);

      await fireComposition(view, "输入法");

      expect(filteredErrors(errors)).toEqual([]);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(serializeMarkdown(view.state.doc)).toContain("输入法");
    });
  });

  it("gap cursor composition creates an editable paragraph", async () => {
    mounted = await createReactEditor("---\n\n```ts\nconst x = 1\n```\n");
    const view = mounted.getView();
    const gapPos = view.state.doc.firstChild!.nodeSize;

    view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(gapPos))));
    await fireComposition(view, "组词");

    expect(topLevelTypes(view.state.doc)).toEqual(["thematic_break", "paragraph", "code"]);
    expect(view.state.doc.child(1).textContent).toContain("组词");
  });

  it("composition can insert inside a table cell without breaking table structure", async () => {
    mounted = await createReactEditor("| A | B |\n|---|---|\n| 1 | 2 |\n");
    const view = mounted.getView();

    setCursor(view, 3);
    await fireComposition(view, "表头");

    expect(topLevelTypes(view.state.doc)).toEqual(["table"]);
    expect(serializeMarkdown(view.state.doc)).toContain("表头");
  });

  it("composition over a text selection replaces the selected content", async () => {
    mounted = await createReactEditor("hello world\n");
    const view = mounted.getView();

    selectRange(view, 7, 12);
    await fireComposition(view, "世界");

    expect(serializeMarkdown(view.state.doc).trim()).toBe("hello 世界");
  });

  it("gap cursor compositionstart sets and clears the composing flag", async () => {
    mounted = await createReactEditor("```ts\nconst a = 1\n```\n\n```ts\nconst b = 2\n```\n");
    const view = mounted.getView();
    const gapPos = view.state.doc.child(0).nodeSize;

    view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(gapPos))));
    const input = getViewInputState(view);
    expect(input.composing).toBe(false);

    view.focus();
    await flushBrowserUpdates();
    await cdpSessionOnce().send("Input.imeSetComposition", {
      text: "测试",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await flushBrowserUpdates();
    expect(input.composing).toBe(true);

    await cdpSessionOnce().send("Input.insertText", { text: "测试" });
    await flushBrowserUpdates();
    await flushBrowserUpdates();
    expect(input.composing).toBe(false);
    expect(view.state.doc.child(1).textContent).toContain("测试");
  });

  it("gap cursor composition undo-redo round-trips correctly", async () => {
    mounted = await createReactEditor("---\n\n```ts\nconst x = 1\n```\n");
    const view = mounted.getView();

    await captureBrowserErrors(async (errors) => {
      const originalTypes = topLevelTypes(view.state.doc);
      const gapPos = view.state.doc.child(0).nodeSize;
      view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(gapPos))));

      await fireComposition(view, "重做");
      const afterCompose = serializeMarkdown(view.state.doc);

      const { undo, redo } = await import("prosemirror-history");
      undo(view.state, view.dispatch.bind(view));
      await flushBrowserUpdates();
      expect(topLevelTypes(view.state.doc)).toEqual(originalTypes);

      redo(view.state, view.dispatch.bind(view));
      await flushBrowserUpdates();
      expect(filteredErrors(errors)).toEqual([]);
      expect(serializeMarkdown(view.state.doc)).toBe(afterCompose);
      expect(topLevelTypes(view.state.doc)).toEqual(["thematic_break", "paragraph", "code"]);
    });
  });

  it("ignores pending composition observer records after the editor is destroyed", async () => {
    mounted = await createReactEditor("before composition after\n");
    const view = mounted.getView();
    view.focus();
    setCursor(view, 8);
    await flushBrowserUpdates();

    await captureBrowserErrors(async (errors) => {
      await cdpSessionOnce().send("Input.imeSetComposition", {
        text: "zhong",
        selectionStart: 5,
        selectionEnd: 5,
      });
      await flushBrowserUpdates();

      const input = view as typeof view & {
        input: ViewInputState;
        domObserver: { lastChangedTextNode?: Text | null };
      };
      const compositionNode =
        input.input.compositionNode ?? input.domObserver.lastChangedTextNode ?? null;
      expect(compositionNode?.nodeType).toBe(Node.TEXT_NODE);

      compositionNode!.textContent = `${compositionNode!.textContent ?? ""}x`;
      mounted!.destroy();
      mounted = null;

      await flushBrowserUpdates();
      await flushBrowserUpdates();

      expect(filteredErrors(errors)).toEqual([]);
    });
  });
});

describe("Interaction fuzz", () => {
  let view: EditorView | null = null;
  let mounted: MountedReactEditor | null = null;

  afterEach(() => {
    if (mounted) mounted.destroy();
    else if (view) destroyEditor(view);
    view = null;
    mounted = null;
  });

  for (let docIdx = 0; docIdx < STARTING_DOCS.length; docIdx++) {
    for (const seedOffset of KEYBOARD_FUZZ_SEEDS) {
      it(`real browser fuzz doc[${docIdx}] seed ${seedOffset}`, async () => {
        const seed = docIdx * 1000 + seedOffset;
        const rng = new Rng(seed);
        const initialMarkdown = STARTING_DOCS[docIdx]!;
        const ops: string[] = [];
        view = createEditor(initialMarkdown);

        await captureBrowserErrors(async (errors) => {
          for (let step = 0; step < KEYBOARD_FUZZ_STEPS; step++) {
            ops.push(`[${step}] ${await realBrowserOp(view!, rng)}`);
          }

          const context = formatFuzzContext(seed, initialMarkdown, ops, view!);
          expect(validatePMNode(view!.state.doc), `${context}\nSchema errors`).toEqual([]);
          expect(
            () => serializeMarkdown(view!.state.doc),
            `${context}\nSerialize failed`,
          ).not.toThrow();
          expect(filteredErrors(errors), `${context}\nBrowser errors`).toEqual([]);
        });
      });
    }
  }

  for (const seed of IME_FUZZ_SEEDS) {
    it(`React IME fuzz over table, horizontal rule, and code stays stable seed ${seed}`, async () => {
      const rng = new Rng(seed);
      const initialMarkdown =
        "before\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n\n```ts\nconst x = 1\n```\n\n> quote\n\n![alt](/image.svg)\n\nafter\n";
      const ops: string[] = [];
      mounted = await createReactEditor(initialMarkdown);
      view = mounted.getView();

      await captureBrowserErrors(async (errors) => {
        for (let step = 0; step < IME_FUZZ_STEPS; step++) {
          if (rng.chance(0.68)) {
            ops.push(`[${step}] ${await browserCompositionOp(view!, rng)}`);
          } else {
            ops.push(`[${step}] ${await realBrowserOp(view!, rng)}`);
          }
        }

        const context = formatFuzzContext(seed, initialMarkdown, ops, view!);
        expect(validatePMNode(view!.state.doc), `${context}\nSchema errors`).toEqual([]);
        expect(
          () => serializeMarkdown(view!.state.doc),
          `${context}\nSerialize failed`,
        ).not.toThrow();
        expect(filteredErrors(errors), `${context}\nBrowser errors`).toEqual([]);
      });
    });
  }
});
