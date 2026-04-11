import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
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

export function fireComposition(view: EditorView, data = "测试"): void {
  const dom = view.dom;
  const { from, to } = view.state.selection;
  const before = JSON.stringify(view.state.doc.toJSON());

  dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  dom.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data }));

  dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data }));

  if (JSON.stringify(view.state.doc.toJSON()) !== before || data.length === 0) {
    return;
  }

  dom.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data,
      inputType: from === to ? "insertText" : "insertReplacementText",
    }),
  );
  dom.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data,
      inputType: from === to ? "insertText" : "insertReplacementText",
    }),
  );

  if (JSON.stringify(view.state.doc.toJSON()) === before) {
    view.dispatch(view.state.tr.insertText(data, from, to));
  }
}

export function topLevelTypes(doc: PMNode): string[] {
  const types: string[] = [];
  doc.forEach((n) => {
    types.push(n.type.name);
  });
  return types;
}
