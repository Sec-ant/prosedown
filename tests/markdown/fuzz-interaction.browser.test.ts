/**
 * Browser-mode fuzz tests.
 *
 * Mounts a full ProseMirror editor in real Chromium and performs random
 * operations to discover hard-to-reproduce bugs. Uses a mix of:
 *
 * - Programmatic ProseMirror API (fast — cursor moves, text inserts, mark toggles)
 * - Real browser keyboard events (slower — but tests real input pipeline)
 *
 * Checks:
 * - No uncaught exceptions or console.error from ProseMirror
 * - The PM document remains schema-valid after operations
 * - Serialization doesn't crash after random operations
 *
 * Run with: vp test --project browser
 */

import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { GapCursor } from "prosemirror-gapcursor";
import { schema, serializeMarkdown } from "../../src/markdown";
import { Rng, generateRandomMarkdown, randomWord, validatePMNode } from "./fuzz-helpers";
import {
  createEditor,
  createReactEditor,
  destroyEditor,
  fireComposition,
  flushBrowserUpdates,
  GC,
  type MountedReactEditor,
} from "./browser-helpers";

const STARTING_DOCS = [
  "# Hello World\n\nSome **bold** and *italic* text.\n\n- Item 1\n- Item 2\n",
  "| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n",
  "1. First item\n2. Second item\n\n---\n\nEnd.\n",
  "- Outer 1\n  - Inner 1\n  - Inner 2\n- Outer 2\n",
];

const EXTRA_DOC_SEEDS = [701, 1701, 2701, 3701];
const STARTING_DOCS_WITH_GENERATED = [
  ...STARTING_DOCS,
  ...EXTRA_DOC_SEEDS.map((seed) => generateRandomMarkdown(new Rng(seed), 10)),
];

function validateDoc(view: EditorView): string[] {
  return validatePMNode(view.state.doc);
}

function randomTextSelection(view: EditorView, rng: Rng): TextSelection | null {
  const candidates: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text && node.text.length > 0) {
      for (let i = 0; i < node.text.length; i++) {
        candidates.push(pos + i);
      }
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

function formatReproContext(
  title: string,
  seed: number,
  initialMarkdown: string,
  ops: string[],
  view?: EditorView,
  error?: unknown,
): string {
  const currentMarkdown =
    view == null
      ? "<editor-not-created>"
      : (() => {
          try {
            return serializeMarkdown(view.state.doc);
          } catch (error) {
            if (error instanceof Error) return `<serialize-failed:${error.name}>`;
            return "<serialize-failed>";
          }
        })();
  const trace = ops.length === 0 ? "(none)" : ops.map((op, idx) => `${idx + 1}. ${op}`).join("\n");

  return [
    `${title} | seed=${seed}`,
    "Initial Markdown:",
    "```md",
    initialMarkdown,
    "```",
    "Operation Trace:",
    "```text",
    trace,
    "```",
    "Current Markdown:",
    "```md",
    currentMarkdown,
    "```",
    ...(error ? ["Error:", "```text", formatUnknownError(error), "```"] : []),
  ].join("\n");
}

function filteredConsoleErrors(consoleErrors: string[]): string[] {
  return consoleErrors.filter(
    (msg) => !msg.includes("vitest") && !msg.includes("React") && !msg.includes("[HMR]"),
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

// ========== Programmatic operations (fast, no browser IPC) ==========

function programmaticOp(view: EditorView, rng: Rng): string {
  const action = rng.int(8);
  const docSize = view.state.doc.content.size;
  if (docSize < 3) return "skip-tiny";

  try {
    switch (action) {
      case 0: {
        const sel = randomTextSelection(view, rng);
        if (!sel) return "skip-no-text-selection";
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.from)));
        return `cursor-move(${sel.from})`;
      }
      case 1: {
        const sel = randomTextSelection(view, rng);
        if (!sel) return "skip-no-range-selection";
        view.dispatch(view.state.tr.setSelection(sel));
        return `select-range(${sel.from},${sel.to})`;
      }
      case 2: {
        // Insert text at random text position
        const pos = rng.range(1, docSize - 1);
        const resolved = view.state.doc.resolve(pos);
        if (resolved.parent.isTextblock) {
          view.dispatch(view.state.tr.insertText(randomWord(rng), pos));
        }
        return "insert-text";
      }
      case 3: {
        // Delete a small range
        const from = rng.range(1, docSize - 2);
        const to = Math.min(from + rng.range(1, 3), docSize - 1);
        view.dispatch(view.state.tr.delete(from, to));
        return "delete";
      }
      case 4: {
        // Toggle a mark on a range
        const markTypes = Object.keys(schema.marks);
        const markName = rng.pick(markTypes);
        const markType = schema.marks[markName]!;
        const from = rng.range(1, docSize - 2);
        const to = Math.min(from + rng.range(1, 5), docSize - 1);
        view.dispatch(view.state.tr.addMark(from, to, markType.create()));
        return `add-mark-${markName}`;
      }
      case 5: {
        // Remove a mark from a range
        const markTypes = Object.keys(schema.marks);
        const markName = rng.pick(markTypes);
        const markType = schema.marks[markName]!;
        const from = rng.range(1, docSize - 2);
        const to = Math.min(from + rng.range(1, 5), docSize - 1);
        view.dispatch(view.state.tr.removeMark(from, to, markType));
        return `remove-mark-${markName}`;
      }
      case 6: {
        // Replace range with text
        const from = rng.range(1, docSize - 2);
        const to = Math.min(from + rng.range(1, 4), docSize - 1);
        const text = schema.text(randomWord(rng));
        view.dispatch(view.state.tr.replaceWith(from, to, text));
        return "replace";
      }
      case 7: {
        // Serialize (test for crashes)
        serializeMarkdown(view.state.doc);
        return "serialize";
      }
    }
  } catch (error) {
    if (error instanceof RangeError) {
      return "caught-range-error";
    }
    throw error;
  }
  return "noop";
}

// ========== Keyboard shortcuts (real browser events) ==========

const SHORTCUTS: string[] = [
  "{Control>}b{/Control}",
  "{Control>}i{/Control}",
  "{Control>}a{/Control}",
  "{Shift>}{ArrowLeft}{/Shift}",
  "{Shift>}{ArrowRight}{/Shift}",
  "{Control>}z{/Control}",
  "{Control>}{Shift>}z{/Shift}{/Control}",
  "{Enter}",
  "{Backspace}",
  "{Delete}",
  "{Tab}",
  "{Shift>}{Tab}{/Shift}",
  "{ArrowLeft}",
  "{ArrowRight}",
  "{ArrowUp}",
  "{ArrowDown}",
];

const TEXT_PATTERNS = ["# ", "- ", "**bold** ", "~~strike~~ ", "```js"] as const;

const MOUSE_EVENTS = ["mousedown", "mouseup", "click", "dblclick"] as const;

function randomEditorElement(view: EditorView, rng: Rng): HTMLElement {
  const editor = view.dom as HTMLElement;
  const elements = [editor, ...Array.from(editor.querySelectorAll<HTMLElement>("*"))];
  return rng.pick(elements);
}

function randomSelectionOp(view: EditorView, rng: Rng): string {
  const sel = randomTextSelection(view, rng);
  if (!sel) return "pm-selection-skip";
  view.dispatch(view.state.tr.setSelection(sel));
  return `pm-selection(${sel.from},${sel.to})`;
}

function browserMouseOp(view: EditorView, rng: Rng): string {
  const target = randomEditorElement(view, rng);
  const type = rng.pick(MOUSE_EVENTS);
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: rng.range(0, 400),
      clientY: rng.range(0, 300),
      detail: type === "dblclick" ? 2 : 1,
    }),
  );
  return `${type}:${target.tagName.toLowerCase()}`;
}

function findTopLevelNodePosByType(view: EditorView, typeName: string): number | null {
  let pos = 0;
  for (let i = 0; i < view.state.doc.childCount; i++) {
    const child = view.state.doc.child(i);
    if (child.type.name === typeName) return pos + 1;
    pos += child.nodeSize;
  }
  return null;
}

function canSelectNodeAt(view: EditorView, pos: number): boolean {
  try {
    const $pos = view.state.doc.resolve(pos);
    return $pos.nodeAfter != null;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

async function browserCompositionOp(view: EditorView, rng: Rng): Promise<string> {
  const compositionText = `${randomWord(rng)}输入`;
  const hrPos = findTopLevelNodePosByType(view, "thematic_break");

  if (hrPos != null && canSelectNodeAt(view, hrPos) && rng.chance(0.6)) {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hrPos)));
  } else if (rng.chance(0.35)) {
    const doc = view.state.doc;
    for (let i = 0, pos = 0; i < doc.childCount - 1; i++) {
      pos += doc.child(i).nodeSize;
      const $pos = doc.resolve(pos);
      if (GC.valid($pos)) {
        view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
        break;
      }
    }
  } else {
    view.focus();
  }

  try {
    await fireComposition(view, compositionText);
  } catch (error) {
    return `composition-insert-error:${String(error)}`;
  }

  return `composition:${view.state.selection.constructor.name}:${compositionText}`;
}

function inputRuleTextOp(view: EditorView, rng: Rng): string {
  const text = rng.pick(TEXT_PATTERNS);
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, char, () => view.state.tr),
    );
    if (!handled) {
      view.dispatch(view.state.tr.insertText(char, from, to));
    }
  }
  return `input-rule-text:${JSON.stringify(text)}`;
}

async function browserKeyboardOp(view: EditorView, rng: Rng): Promise<string> {
  view.focus();
  const shortcut = rng.pick(SHORTCUTS);
  await userEvent.keyboard(shortcut);
  return shortcut;
}

async function chaoticBrowserOp(view: EditorView, rng: Rng): Promise<string> {
  switch (rng.int(6)) {
    case 0:
      return randomSelectionOp(view, rng);
    case 1:
      return browserMouseOp(view, rng);
    case 2:
      return browserKeyboardOp(view, rng);
    case 3:
      return await browserCompositionOp(view, rng);
    case 4:
      return inputRuleTextOp(view, rng);
    default:
      view.focus();
      await userEvent.keyboard(randomWord(rng));
      return "type-word";
  }
}

// ========== Tests ==========

describe("Browser fuzz: random editor operations", () => {
  let view: EditorView;
  let consoleErrors: string[];
  let originalConsoleError: typeof console.error;
  let onWindowError: ((event: ErrorEvent) => void) | undefined;
  let onUnhandledRejection: ((event: PromiseRejectionEvent) => void) | undefined;

  beforeEach(() => {
    consoleErrors = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
      originalConsoleError.apply(console, args);
    };
    onWindowError = (event) => {
      consoleErrors.push(`window.error ${event.message}`);
    };
    onUnhandledRejection = (event) => {
      consoleErrors.push(`window.unhandledrejection ${String(event.reason)}`);
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
  });

  afterEach(() => {
    console.error = originalConsoleError;
    if (onWindowError) window.removeEventListener("error", onWindowError);
    if (onUnhandledRejection)
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    if (view) destroyEditor(view);
  });

  for (let docIdx = 0; docIdx < STARTING_DOCS_WITH_GENERATED.length; docIdx++) {
    it(`fuzz doc[${docIdx}]: programmatic ops`, () => {
      const seed = docIdx * 100;
      const initialMarkdown = STARTING_DOCS_WITH_GENERATED[docIdx]!;
      const rng = new Rng(seed);
      view = createEditor(initialMarkdown);

      const ops: string[] = [];
      const title = `programmatic doc[${docIdx}]`;

      for (let step = 0; step < 90; step++) {
        try {
          const op = programmaticOp(view, rng);
          ops.push(`[${step}] ${op}`);
        } catch (error) {
          ops.push(`[${step}] throw:${String(error)}`);
          throw new Error(formatReproContext(title, seed, initialMarkdown, ops, view, error));
        }
      }

      const errors = validateDoc(view);
      const context = formatReproContext(title, seed, initialMarkdown, ops, view);
      expect(errors, `${context}\nSchema errors`).toEqual([]);
      expect(() => serializeMarkdown(view.state.doc)).not.toThrow();
      expect(filteredConsoleErrors(consoleErrors), `${context}\nConsole errors`).toEqual([]);
    });
  }

  for (let docIdx = 0; docIdx < STARTING_DOCS_WITH_GENERATED.length; docIdx++) {
    it(`fuzz doc[${docIdx}]: browser chaos`, async () => {
      const seed = docIdx * 100 + 50;
      const initialMarkdown = STARTING_DOCS_WITH_GENERATED[docIdx]!;
      const rng = new Rng(seed);
      const title = `browser-chaos doc[${docIdx}]`;
      view = createEditor(initialMarkdown);

      view.focus();

      const ops: string[] = [];

      for (let step = 0; step < 24; step++) {
        try {
          ops.push(`[${step}] ${await chaoticBrowserOp(view, rng)}`);
        } catch (error) {
          ops.push(`[${step}] throw:${String(error)}`);
          throw new Error(formatReproContext(title, seed, initialMarkdown, ops, view, error));
        }
      }

      const errors = validateDoc(view);
      const context = formatReproContext(title, seed, initialMarkdown, ops, view);
      expect(errors, `${context}\nSchema errors`).toEqual([]);
      expect(() => serializeMarkdown(view.state.doc)).not.toThrow();
      expect(filteredConsoleErrors(consoleErrors), `${context}\nConsole errors`).toEqual([]);
    });
  }

  it("mixed programmatic + keyboard fuzz", async () => {
    const rng = new Rng(42);
    const seed = 42;
    const initialMarkdown = generateRandomMarkdown(new Rng(4042), 12);
    const title = "mixed-programmatic-browser";
    view = createEditor(initialMarkdown);

    view.focus();

    const ops: string[] = [];

    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 14; i++) {
        const step = ops.length;
        ops.push(`[${step}] ${programmaticOp(view, rng)}`);
      }
      for (let i = 0; i < 4; i++) {
        const step = ops.length;
        try {
          ops.push(`[${step}] ${await chaoticBrowserOp(view, rng)}`);
        } catch (error) {
          ops.push(`[${step}] throw:${String(error)}`);
          throw new Error(formatReproContext(title, seed, initialMarkdown, ops, view, error));
        }
      }
    }

    const errors = validateDoc(view);
    const context = formatReproContext(title, seed, initialMarkdown, ops, view);
    expect(errors, `${context}\nSchema errors`).toEqual([]);
    expect(() => serializeMarkdown(view.state.doc)).not.toThrow();
    expect(filteredConsoleErrors(consoleErrors), `${context}\nConsole errors`).toEqual([]);
  });

  it("random generated documents survive browser chaos without ProseMirror console noise", async () => {
    for (const seed of EXTRA_DOC_SEEDS) {
      const rng = new Rng(seed);
      const initialMarkdown = generateRandomMarkdown(rng, 14);
      const title = `random-generated seed=${seed}`;
      view = createEditor(initialMarkdown);
      view.focus();

      const ops: string[] = [];

      for (let step = 0; step < 32; step++) {
        try {
          ops.push(`[${ops.length}] ${await chaoticBrowserOp(view, rng)}`);
          if (rng.int(3) === 0) {
            ops.push(`[${ops.length}] ${programmaticOp(view, rng)}`);
          }
        } catch (error) {
          ops.push(`[${ops.length}] throw:${String(error)}`);
          throw new Error(formatReproContext(title, seed, initialMarkdown, ops, view, error));
        }
      }

      const context = formatReproContext(title, seed, initialMarkdown, ops, view);
      expect(validateDoc(view), `${context}\nSchema errors`).toEqual([]);
      expect(() => serializeMarkdown(view.state.doc), `${context}\nSerialize failed`).not.toThrow();
      expect(filteredConsoleErrors(consoleErrors), `${context}\nConsole errors`).toEqual([]);

      destroyEditor(view);
      // Reset between seeds so leaked state does not pollute the next run.
      view = createEditor("");
      destroyEditor(view);
      consoleErrors = [];
    }
  });

  it("IME-heavy fuzz around horizontal rules and gap cursor stays stable", async () => {
    const seed = 88001;
    const initialMarkdown = "before\n\n---\n\n```ts\nconst x = 1\n```\n\nafter\n";
    const rng = new Rng(seed);
    const title = "ime-heavy-horizontal-rule-gap-cursor";
    view = createEditor(initialMarkdown);

    const ops: string[] = [];
    for (let step = 0; step < 40; step++) {
      try {
        if (step % 3 === 0) {
          ops.push(`[${step}] ${await browserCompositionOp(view, rng)}`);
        } else {
          ops.push(`[${step}] ${await chaoticBrowserOp(view, rng)}`);
        }
      } catch (error) {
        ops.push(`[${step}] throw:${String(error)}`);
        throw new Error(formatReproContext(title, seed, initialMarkdown, ops, view, error));
      }
    }

    const context = formatReproContext(title, seed, initialMarkdown, ops, view);
    expect(validateDoc(view), `${context}\nSchema errors`).toEqual([]);
    expect(() => serializeMarkdown(view.state.doc), `${context}\nSerialize failed`).not.toThrow();
    expect(filteredConsoleErrors(consoleErrors), `${context}\nConsole errors`).toEqual([]);
  });
});

describe("Browser fuzz: ReactEditorView IME-heavy operations", () => {
  let mounted: MountedReactEditor | null;
  let consoleErrors: string[];
  let originalConsoleError: typeof console.error;
  let onWindowError: ((event: ErrorEvent) => void) | undefined;
  let onUnhandledRejection: ((event: PromiseRejectionEvent) => void) | undefined;

  beforeEach(() => {
    mounted = null;
    consoleErrors = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
      originalConsoleError.apply(console, args);
    };
    onWindowError = (event) => {
      consoleErrors.push(`window.error ${event.message}`);
    };
    onUnhandledRejection = (event) => {
      consoleErrors.push(`window.unhandledrejection ${String(event.reason)}`);
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
  });

  afterEach(() => {
    console.error = originalConsoleError;
    if (onWindowError) window.removeEventListener("error", onWindowError);
    if (onUnhandledRejection)
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    mounted?.destroy();
    mounted = null;
  });

  it("random IME operations over thematic_break/table/code stay stable", async () => {
    const seed = 99123;
    const rng = new Rng(seed);
    const initialMarkdown =
      "before\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n\n```ts\nconst x = 1\n```\n\nafter\n";
    mounted = await createReactEditor(initialMarkdown);
    const view = mounted.getView();

    const ops: string[] = [];
    for (let step = 0; step < 36; step++) {
      try {
        ops.push(`[${step}] ${await browserCompositionOp(view, rng)}`);
        if (rng.chance(0.5)) {
          ops.push(`[${ops.length}] ${await chaoticBrowserOp(view, rng)}`);
        }
        await flushBrowserUpdates();
      } catch (error) {
        ops.push(`[${step}] throw:${String(error)}`);
        throw new Error(
          formatReproContext("react-ime-heavy-fuzz", seed, initialMarkdown, ops, view, error),
        );
      }
    }

    const context = formatReproContext("react-ime-heavy-fuzz", seed, initialMarkdown, ops, view);
    expect(validateDoc(view), `${context}\nSchema errors`).toEqual([]);
    expect(() => serializeMarkdown(view.state.doc), `${context}\nSerialize failed`).not.toThrow();
    expect(filteredConsoleErrors(consoleErrors), `${context}\nConsole errors`).toEqual([]);
  });

  it("react ime known-failure seed no longer crashes after upstream fix", async () => {
    const seed = 99123;
    const rng = new Rng(seed);
    const initialMarkdown =
      "before\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n\n```ts\nconst x = 1\n```\n\nafter\n";
    mounted = await createReactEditor(initialMarkdown);
    const view = mounted.getView();

    const ops: string[] = [];

    for (let step = 0; step < 36; step++) {
      try {
        ops.push(`[${step}] ${await browserCompositionOp(view, rng)}`);
        if (rng.chance(0.5)) {
          ops.push(`[${ops.length}] ${await chaoticBrowserOp(view, rng)}`);
        }
        await flushBrowserUpdates();
      } catch (error) {
        ops.push(`[${step}] throw:${String(error)}`);
      }
    }

    const context = formatReproContext(
      "react-ime-known-failure-seed",
      seed,
      initialMarkdown,
      ops,
      view,
    );

    // After the upstream beforeInputPlugin fix, this seed should no longer
    // produce HierarchyRequestError. The DOM restoration is wrapped in
    // try/catch and non-textblock selections are handled gracefully.
    const errors = filteredConsoleErrors(consoleErrors);
    const hasHierarchyError = errors.some((msg) => msg.includes("HierarchyRequestError"));
    expect(
      hasHierarchyError,
      `${context}\nHierarchyRequestError should no longer occur after upstream fix`,
    ).toBe(false);

    // Document should remain schema-valid
    expect(validateDoc(view), `${context}\nSchema errors`).toEqual([]);
    expect(() => serializeMarkdown(view.state.doc), `${context}\nSerialize failed`).not.toThrow();
  });
});
