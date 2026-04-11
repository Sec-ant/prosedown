import { Selection, TextSelection, type Command } from "prosemirror-state";
import type { Code } from "mdast";
import type { Extension } from "../types";

// ---- Code block keymap commands ----

/** Tab: insert 2 spaces at cursor (or replace selection) inside a code block. */
const codeBlockTab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "code") return false;
  if (dispatch) {
    const { from, to } = state.selection;
    dispatch(state.tr.insertText("  ", from, to));
  }
  return true;
};

/** Shift-Tab: remove up to 2 leading spaces from the current line inside a code block. */
const codeBlockShiftTab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "code") return false;
  if (dispatch) {
    const text = $from.parent.textContent;
    const offset = $from.parentOffset;
    // Find start of current line within the code block text
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    // Count leading spaces on this line (up to 2)
    let spacesToRemove = 0;
    for (let i = lineStart; i < lineStart + 2 && i < text.length; i++) {
      if (text[i] === " ") spacesToRemove++;
      else break;
    }
    if (spacesToRemove > 0) {
      const absStart = $from.start(); // absolute pos of code block content start
      const deleteFrom = absStart + lineStart;
      const deleteTo = deleteFrom + spacesToRemove;
      dispatch(state.tr.delete(deleteFrom, deleteTo));
    }
  }
  return true;
};

/** Mod-Enter: exit code block by creating a paragraph below and moving cursor there. */
const exitCodeBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "code") return false;
  if (dispatch) {
    const after = $from.after(); // position right after the code block node
    const paragraph = state.schema.nodes.paragraph!.create();
    const tr = state.tr.insert(after, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch(tr);
  }
  return true;
};

/** ArrowDown at last line: exit code block if cursor is on the last line. */
const arrowDownExit: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "code") return false;
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;
  // If there's a \n after cursor position, we're not on the last line
  if (text.indexOf("\n", offset) !== -1) return false;
  if (dispatch) {
    const after = $from.after(); // position right after the code block
    // Check if there's a next sibling node
    if (after < state.doc.content.size) {
      // Move cursor into the next block
      const sel = Selection.findFrom(state.doc.resolve(after), 1);
      if (sel) {
        dispatch(state.tr.setSelection(sel));
        return true;
      }
    }
    // No next block — create a paragraph
    const paragraph = state.schema.nodes.paragraph!.create();
    const tr = state.tr.insert(after, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch(tr);
  }
  return true;
};

/** Enter on a line matching ```lang: convert paragraph to code block. */
const enterCodeFence: Command = (state, dispatch) => {
  const { $from } = state.selection;
  // Must be inside a paragraph (not already inside a code block)
  if (!$from.parent.type.isTextblock || $from.parent.type.spec.code) return false;
  const text = $from.parent.textContent;
  const match = text.match(/^```([a-zA-Z]*)$/);
  if (!match) return false;
  if (dispatch) {
    const lang = match[1] || null;
    const pos = $from.before();
    const end = $from.after();
    const codeBlockNode = state.schema.nodes.code!.createAndFill({ lang })!;
    const tr = state.tr.replaceWith(pos, end, codeBlockNode);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    dispatch(tr);
  }
  return true;
};
const backspaceEmptyCodeBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "code") return false;
  if ($from.parent.textContent.length !== 0 || $from.parentOffset !== 0) return false;
  if (dispatch) {
    dispatch(state.tr.setBlockType($from.before(), $from.after(), state.schema.nodes.paragraph!));
  }
  return true;
};

export const codeExt: Extension = {
  nodes: {
    code: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      defining: true,
      createGapCursor: true,
      attrs: {
        lang: { default: null },
        meta: { default: null },
      },
      toDOM: (node) => {
        const lang = node.attrs.lang as string | null;
        const codeAttrs = lang ? { class: `language-${lang}` } : {};
        return ["pre", ["code", codeAttrs, 0]] as const;
      },
      parseDOM: [
        {
          tag: "pre",
          preserveWhitespace: "full" as const,
          contentElement: (dom) =>
            (dom as HTMLElement).querySelector("code") || (dom as HTMLElement),
          getAttrs: (dom: HTMLElement) => {
            const cls = dom.querySelector("code")?.className ?? "";
            const match = cls.match(/(?:^|\s)language-(\S+)/);
            return { lang: match ? match[1] : null };
          },
        },
      ],
    },
  },
  handlers: [
    {
      type: "leaf",
      mdastType: "code",
      pmType: "code",
      attrs: (node) => ({
        lang: (node as Code).lang ?? null,
        meta: (node as Code).meta ?? null,
      }),
      toMdast: (node) => ({
        type: "code",
        lang: node.attrs.lang as string | null,
        meta: node.attrs.meta as string | null,
        value: node.textContent,
      }),
    },
  ],
  keymap: (_schema) => ({
    Enter: enterCodeFence,
    Tab: codeBlockTab,
    "Shift-Tab": codeBlockShiftTab,
    "Mod-Enter": exitCodeBlock,
    ArrowDown: arrowDownExit,
    Backspace: backspaceEmptyCodeBlock,
  }),
};
