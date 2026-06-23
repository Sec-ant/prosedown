import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { cdp } from "vite-plus/test/browser/context";
import {
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEffect,
} from "@handlewithcare/react-prosemirror";
import { GapCursor } from "prosemirror-gapcursor";
import type { Node as PMNode, ResolvedPos } from "prosemirror-model";
import { EditorState, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { createDefaultPlugins } from "../../src/editor/plugins";
import { parseMarkdown, schema } from "../../src/markdown";

export type MountedReactEditor = {
  root: Root;
  container: HTMLDivElement;
  getView: () => EditorView;
  destroy: () => void;
};

type ViewInputState = {
  composing: boolean;
};

function docFromContent(content?: string | PMNode): PMNode {
  if (typeof content === "string") return parseMarkdown(content);
  if (content) return content;
  return schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
}

export const GC = GapCursor as unknown as {
  valid: (pos: ResolvedPos) => boolean;
  findGapCursorFrom?: (pos: ResolvedPos, dir: number, mustMove?: boolean) => ResolvedPos | null;
};

export function createEditorState(doc: PMNode): EditorState {
  return EditorState.create({
    doc,
    schema,
    plugins: createDefaultPlugins(),
  });
}

export function createReactEditorState(doc: PMNode): EditorState {
  return EditorState.create({
    doc,
    schema,
    plugins: [reactKeys(), ...createDefaultPlugins()],
  });
}

export function createEditor(content?: string | PMNode): EditorView {
  const doc = docFromContent(content);
  const state = createEditorState(doc);
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new EditorView(el, { state });
}

export function destroyEditor(view: EditorView): void {
  view.destroy();
  view.dom.parentNode?.removeChild(view.dom);
}

export async function createReactEditor(
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

export function getViewInputState(view: EditorView): ViewInputState {
  return (view as EditorView & { input: ViewInputState }).input;
}

export async function flushBrowserUpdates(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Lazily-created CDP session, shared across all compositions in a test run. */
let cdpSession: ReturnType<typeof cdp> | null = null;
function cdpSessionOnce(): ReturnType<typeof cdp> {
  cdpSession ??= cdp();
  return cdpSession;
}

/**
 * Drive a real IME composition through the Chrome DevTools Protocol.
 *
 * This goes through Chromium's *native* IME path (the same one a physical
 * Pinyin/Kana keyboard uses): `Input.imeSetComposition` fires real
 * `compositionstart`/`compositionupdate` events and mutates the DOM the way the
 * browser actually does, and `Input.insertText` commits it with a real
 * `compositionend`. This exercises prosemirror-view's MutationObserver, React's
 * re-render, and the browser caret behaviour for real — unlike synthetic
 * `dispatchEvent` calls, which can only approximate them and silently miss bugs
 * (e.g. the post-commit caret jumping to the start of the line).
 *
 * The composition happens at the current DOM caret, so callers set the desired
 * ProseMirror selection first (any selection type works: a collapsed cursor, a
 * range to replace, a gap cursor between blocks, or a node selection — the
 * editor's compositionstart handler deletes/wraps as needed before the insert).
 */
export async function fireComposition(view: EditorView, data = "测试"): Promise<void> {
  const session = cdpSessionOnce();
  view.focus();
  // Sync the browser caret to ProseMirror's current selection. CDP composes at
  // the live DOM caret, so after programmatic selection changes (common in
  // tests) we must push PM's selection into the DOM first, or the IME would
  // compose at a stale position.
  syncDomSelectionToState(view);
  await flushBrowserUpdates();

  if (data.length > 0) {
    // Progressive composition updates, mirroring a multi-keystroke Pinyin entry,
    // then a commit. Each step is flushed so React can apply intermediate renders.
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
    // Empty commit: start then immediately cancel the composition.
    await session.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
  }
  await flushBrowserUpdates();
  await flushBrowserUpdates();
}

/** Force the browser DOM selection to match ProseMirror's current selection. */
function syncDomSelectionToState(view: EditorView): void {
  const { selection } = view.state;
  const docView = (view as EditorView & { docView: { setSelection?: unknown } }).docView;
  // ReactEditorView always keeps docView set; guard anyway for safety.
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
    // Some selection types (e.g. a node selection on an atom) can't map to a
    // text DOM range; the editor's compositionstart handler will reconcile.
  } finally {
    domObserver.setCurSelection();
    domObserver.connectSelection();
  }
}

export function topLevelTypes(doc: PMNode): string[] {
  const types: string[] = [];
  doc.forEach((n) => {
    types.push(n.type.name);
  });
  return types;
}
