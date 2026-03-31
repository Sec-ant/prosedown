import { wrappingInputRule } from "prosemirror-inputrules";
import { TextSelection, type Command } from "prosemirror-state";
import { liftTarget } from "prosemirror-transform";
import type { Extension } from "../types";
import { mdastNode } from "../types";

// ---- Blockquote keymap commands ----

/**
 * Backspace on an empty paragraph inside a blockquote.
 *
 * Fires when:
 * - cursor is at the start of a textblock (parentOffset = 0)
 * - that textblock is empty (content.size = 0)
 * - the grandparent is a blockquote
 *
 * Behavior:
 * - Last child with siblings: delete the empty paragraph and place cursor
 *   at end of previous sibling (user expects "undo Enter").
 * - Only child: replace the entire blockquote with a plain paragraph.
 * - First/middle child: lift the empty paragraph out of the blockquote.
 */
const backspaceInBlockquote: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parentOffset > 0) return false;
  if (!$from.parent.type.isTextblock) return false;
  if ($from.parent.content.size > 0) return false;
  if ($from.depth < 2) return false;
  const blockquoteDepth = $from.depth - 1;
  const grandparent = $from.node(blockquoteDepth);
  if (grandparent.type.name !== "blockquote") return false;

  if (!dispatch) return true;

  const indexInBq = $from.index(blockquoteDepth);

  // Only child — replace blockquote with empty paragraph
  if (grandparent.childCount === 1) {
    const bqPos = $from.before(blockquoteDepth);
    const tr = state.tr;
    tr.replaceWith(
      bqPos,
      bqPos + grandparent.nodeSize,
      state.schema.nodes.paragraph!.createAndFill()!,
    );
    tr.setSelection(TextSelection.create(tr.doc, bqPos + 1));
    dispatch(tr);
    return true;
  }

  // Last child — delete the empty paragraph, cursor to end of previous sibling
  if (indexInBq === grandparent.childCount - 1) {
    const emptyParaPos = $from.before($from.depth);
    const tr = state.tr;
    tr.delete(emptyParaPos, emptyParaPos + $from.parent.nodeSize);
    // Place cursor at end of the (now) last child in the blockquote
    const bqStart = $from.start(blockquoteDepth);
    const newBq = tr.doc.resolve(bqStart).parent;
    let endPos = bqStart;
    for (let i = 0; i < newBq.childCount; i++) {
      endPos += newBq.child(i).nodeSize;
    }
    // endPos is now right after last child's closing tag; -1 puts us inside it
    tr.setSelection(TextSelection.create(tr.doc, endPos - 1));
    dispatch(tr);
    return true;
  }

  // First / middle child — lift out of blockquote
  const range = $from.blockRange();
  if (!range) return false;
  const target = liftTarget(range);
  if (target == null) return false;
  dispatch(state.tr.lift(range, target));
  return true;
};

/**
 * Enter on an empty paragraph inside a blockquote — exit the blockquote.
 *
 * Three cases:
 * 1. Blockquote has only this one empty paragraph → replace entire blockquote
 *    with a plain paragraph.
 * 2. Empty paragraph is the last child → remove it and insert a paragraph
 *    after the blockquote.
 * 3. Empty paragraph is in the middle → lift it out of the blockquote.
 */
const enterInBlockquote: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parentOffset > 0) return false;
  if (!$from.parent.type.isTextblock) return false;
  if ($from.parent.content.size > 0) return false;
  if ($from.depth < 2) return false;
  const blockquoteDepth = $from.depth - 1;
  const grandparent = $from.node(blockquoteDepth);
  if (grandparent.type.name !== "blockquote") return false;

  if (!dispatch) return true;

  const blockquote = grandparent;

  // Case 1: only child — replace the whole blockquote with a paragraph
  if (blockquote.childCount === 1) {
    const bqPos = $from.before(blockquoteDepth);
    const tr = state.tr;
    tr.replaceWith(
      bqPos,
      bqPos + blockquote.nodeSize,
      state.schema.nodes.paragraph!.createAndFill()!,
    );
    tr.setSelection(TextSelection.create(tr.doc, bqPos + 1));
    dispatch(tr);
    return true;
  }

  // Case 2: last child — delete the empty para and insert after blockquote
  const indexInBq = $from.index(blockquoteDepth);
  if (indexInBq === blockquote.childCount - 1) {
    const emptyParaPos = $from.before($from.depth);
    const bqEnd = $from.after(blockquoteDepth);
    const tr = state.tr;
    // Delete the empty paragraph from blockquote
    tr.delete(emptyParaPos, emptyParaPos + $from.parent.nodeSize);
    // Insert paragraph after blockquote (position shifted by deletion)
    const insertPos = tr.mapping.map(bqEnd);
    tr.insert(insertPos, state.schema.nodes.paragraph!.createAndFill()!);
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    dispatch(tr);
    return true;
  }

  // Case 3: middle — lift out of blockquote
  const range = $from.blockRange();
  if (!range) return false;
  const target = liftTarget(range);
  if (target == null) return false;
  dispatch(state.tr.lift(range, target));
  return true;
};

export const blockquote: Extension = {
  nodes: {
    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      createGapCursor: true,
      toDOM: () => ["blockquote", 0] as const,
      parseDOM: [{ tag: "blockquote" }],
    },
  },
  handlers: [
    {
      type: "node",
      mdastType: "blockquote",
      pmType: "blockquote",
      toMdast: (_node, children) => mdastNode({ type: "blockquote", children }),
    },
  ],
  inputRules: (schema) => [wrappingInputRule(/^\s{0,3}>\s$/, schema.nodes.blockquote)],
  keymap: (_schema) => ({
    Backspace: backspaceInBlockquote,
    Enter: enterInBlockquote,
  }),
};
