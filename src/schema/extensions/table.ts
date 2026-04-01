import type { AlignType, Table } from "mdast";
import {
  Plugin,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode, ResolvedPos } from "prosemirror-model";
import type { Extension } from "../types";
import { mdastNode } from "../types";

// ---- Table cell navigation helpers ----

/** Find the depth of the enclosing table cell. */
function findCellDepth($pos: ResolvedPos): number | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table_cell") {
      return d;
    }
  }
  return null;
}

/** Tab: move to the next cell, or create a new row if at the last cell. */
const tableTab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const cellDepth = findCellDepth($from);
  if (cellDepth == null) return false;

  const rowDepth = cellDepth - 1;
  const tableDepth = cellDepth - 2;

  const cellIdx = $from.index(rowDepth);
  const rowNode = $from.node(rowDepth);
  const rowIdx = $from.index(tableDepth);
  const tableNode = $from.node(tableDepth);

  if (dispatch) {
    const tr = state.tr;

    if (cellIdx < rowNode.childCount - 1) {
      // Not last cell in row → move to next cell
      const nextCellContentStart = $from.after(cellDepth) + 1;
      tr.setSelection(TextSelection.create(tr.doc, nextCellContentStart));
    } else if (rowIdx < tableNode.childCount - 1) {
      // Last cell but not last row → first cell of next row
      const nextCellContentStart = $from.after(rowDepth) + 2;
      tr.setSelection(TextSelection.create(tr.doc, nextCellContentStart));
    } else {
      // Last cell of last row → create a new data row and move into it
      const numCols = rowNode.childCount;
      const cells = [];
      for (let i = 0; i < numCols; i++) {
        cells.push(state.schema.nodes.table_cell!.createAndFill()!);
      }
      const newRow = state.schema.nodes.table_row!.create(null, cells);
      const insertPos = $from.after(rowDepth);
      tr.insert(insertPos, newRow);
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
    }

    dispatch(tr);
  }
  return true;
};

/**
 * Enter inside a table cell:
 * - If not in the last row → move cursor to same column in next row.
 * - If in the last row → exit the table by inserting a paragraph below.
 */
const tableEnter: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const cellDepth = findCellDepth($from);
  if (cellDepth == null) return false;

  const rowDepth = cellDepth - 1;
  const tableDepth = cellDepth - 2;

  const cellIdx = $from.index(rowDepth);
  const rowIdx = $from.index(tableDepth);
  const tableNode = $from.node(tableDepth);

  if (dispatch) {
    const tr = state.tr;

    if (rowIdx < tableNode.childCount - 1) {
      // Not last row → move to same column in next row
      const nextRow = tableNode.child(rowIdx + 1);
      // Clamp cellIdx to next row's cell count
      const targetCol = Math.min(cellIdx, nextRow.childCount - 1);

      // Calculate position: start after the next row's opening, then skip targetCol cells
      let targetPos = $from.after(rowDepth) + 1; // skip into next row
      for (let i = 0; i < targetCol; i++) {
        targetPos += nextRow.child(i).nodeSize;
      }
      targetPos += 1; // enter the cell
      tr.setSelection(TextSelection.create(tr.doc, targetPos));
    } else {
      // Last row → exit table: insert paragraph below
      const tableEnd = $from.after(tableDepth);
      const paragraph = state.schema.nodes.paragraph!.create();
      tr.insert(tableEnd, paragraph);
      tr.setSelection(TextSelection.create(tr.doc, tableEnd + 1));
    }

    dispatch(tr);
  }
  return true;
};

/**
 * Backspace at the start of a table cell → move cursor to end of previous cell.
 * At the start of the very first cell → do nothing (prevent structural damage).
 */
const tableBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false; // let default handle non-collapsed selections
  const cellDepth = findCellDepth($from);
  if (cellDepth == null) return false;
  if ($from.parentOffset !== 0) return false; // not at cell start

  const rowDepth = cellDepth - 1;
  const tableDepth = cellDepth - 2;
  const cellIdx = $from.index(rowDepth);
  const rowIdx = $from.index(tableDepth);

  if (cellIdx === 0 && rowIdx === 0) {
    // First cell of first row — do nothing, just consume the key
    return true;
  }

  if (dispatch) {
    const tr = state.tr;

    if (cellIdx > 0) {
      // Move to end of previous cell in same row
      // $from.before(cellDepth) is the position right before the current cell.
      // Subtract 1 to land on the closing tag of the previous cell,
      // subtract 1 more (-2 total) to land inside the previous cell content.
      const $prev = state.doc.resolve($from.before(cellDepth) - 1);
      const prevCellDepth = findCellDepth($prev);
      if (prevCellDepth != null) {
        tr.setSelection(TextSelection.create(tr.doc, $prev.end(prevCellDepth)));
      }
    } else {
      // First cell in row → move to end of last cell of previous row
      // $from.before(rowDepth) is the position right before the current row.
      // Subtract 2 to skip the previous row's closing tag and land inside
      // the last cell of the previous row.
      const $prev = state.doc.resolve($from.before(rowDepth) - 2);
      const prevCellDepth = findCellDepth($prev);
      if (prevCellDepth != null) {
        tr.setSelection(TextSelection.create(tr.doc, $prev.end(prevCellDepth)));
      }
    }

    dispatch(tr);
  }
  return true;
};

/**
 * Delete at the end of a table cell → move cursor to start of next cell.
 * At the end of the very last cell → do nothing (prevent structural damage).
 */
const tableDelete: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const cellDepth = findCellDepth($from);
  if (cellDepth == null) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false; // not at cell end

  const rowDepth = cellDepth - 1;
  const tableDepth = cellDepth - 2;
  const cellIdx = $from.index(rowDepth);
  const rowIdx = $from.index(tableDepth);
  const rowNode = $from.node(rowDepth);
  const tableNode = $from.node(tableDepth);

  if (cellIdx === rowNode.childCount - 1 && rowIdx === tableNode.childCount - 1) {
    // Last cell of last row — do nothing
    return true;
  }

  if (dispatch) {
    const tr = state.tr;

    if (cellIdx < rowNode.childCount - 1) {
      // Move to start of next cell in same row
      const nextCellStart = $from.after(cellDepth) + 1;
      tr.setSelection(TextSelection.create(tr.doc, nextCellStart));
    } else {
      // Last cell in row → move to start of first cell of next row
      const nextRowStart = $from.after(rowDepth) + 2; // skip row open + cell open
      tr.setSelection(TextSelection.create(tr.doc, nextRowStart));
    }

    dispatch(tr);
  }
  return true;
};

/**
 * ArrowUp at the start of the first cell in the first row → move before the table.
 * This lets normal selection resolution land in the content above.
 */
const tableArrowUp: Command = (state, dispatch, view) => {
  if (!view) return false;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const cellDepth = findCellDepth($from);
  if (cellDepth == null) return false;

  // Only trigger when view says we're at the top of the textblock
  if (!view.endOfTextblock("up")) return false;

  const tableDepth = cellDepth - 2;
  const rowIdx = $from.index(tableDepth);

  // Only in the first row
  if (rowIdx !== 0) return false;

  if (dispatch) {
    // Position right before the table node
    const beforeTable = $from.before(tableDepth);
    const $target = state.doc.resolve(beforeTable);
    const sel = TextSelection.near($target, -1);
    dispatch(state.tr.setSelection(sel));
  }
  return true;
};

/**
 * ArrowDown at the end of the last cell in the last row → move after the table.
 */
const tableArrowDown: Command = (state, dispatch, view) => {
  if (!view) return false;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const cellDepth = findCellDepth($from);
  if (cellDepth == null) return false;

  // Only trigger when view says we're at the bottom of the textblock
  if (!view.endOfTextblock("down")) return false;

  const tableDepth = cellDepth - 2;
  const rowIdx = $from.index(tableDepth);
  const tableNode = $from.node(tableDepth);

  // Only in the last row
  if (rowIdx !== tableNode.childCount - 1) return false;

  if (dispatch) {
    // Position right after the table node
    const afterTable = $from.after(tableDepth);
    const $target = state.doc.resolve(afterTable);
    const sel = TextSelection.near($target, 1);
    dispatch(state.tr.setSelection(sel));
  }
  return true;
};

/** Shift-Tab: move to the previous cell. */
const tableShiftTab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const cellDepth = findCellDepth($from);
  if (cellDepth == null) return false;

  const rowDepth = cellDepth - 1;
  const tableDepth = cellDepth - 2;

  const cellIdx = $from.index(rowDepth);
  const rowIdx = $from.index(tableDepth);

  if (dispatch) {
    const tr = state.tr;

    if (cellIdx > 0) {
      // Not first cell → move to start of previous cell
      const $prev = state.doc.resolve($from.before(cellDepth) - 1);
      const prevCellDepth = findCellDepth($prev);
      if (prevCellDepth != null) {
        tr.setSelection(TextSelection.create(tr.doc, $prev.start(prevCellDepth)));
      }
    } else if (rowIdx > 0) {
      // First cell but not first row → start of last cell of previous row
      const $prev = state.doc.resolve($from.before(rowDepth) - 2);
      const prevCellDepth = findCellDepth($prev);
      if (prevCellDepth != null) {
        tr.setSelection(TextSelection.create(tr.doc, $prev.start(prevCellDepth)));
      }
    }
    // First cell of first row → do nothing (return true to prevent default)

    dispatch(tr);
  }
  return true;
};

/**
 * Insert a 3×2 table and place the cursor in the first cell.
 */
export function insertTable(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { table: tbl, table_row: row, table_cell: td } = state.schema.nodes;
  if (!tbl || !row || !td) return false;

  if (dispatch) {
    const { $from } = state.selection;
    const rows = [];
    for (let r = 0; r < 2; r++) {
      const cells = [];
      for (let c = 0; c < 3; c++) {
        cells.push(td.createAndFill()!);
      }
      rows.push(row.create(null, cells));
    }
    const tableNode = tbl.create(null, rows);

    const insertPos = $from.after(1); // after current top-level block
    const tr = state.tr.insert(insertPos, tableNode);
    // table open + row open + cell open = 3 positions from insertPos
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 3));
    dispatch(tr);
  }
  return true;
}

export const tableExt: Extension = {
  nodes: {
    table: {
      content: "table_row+",
      group: "block",
      isolating: true,
      allowGapCursor: false,
      attrs: { align: { default: [] } },
      toDOM: () => ["table", ["tbody", 0]] as const,
      parseDOM: [
        {
          tag: "table",
          getAttrs: (dom: HTMLElement) => {
            const align: (string | null)[] = [];
            const firstRow = dom.querySelector("tr");
            if (firstRow) {
              firstRow.querySelectorAll("td, th").forEach((cell) => {
                const el = cell as HTMLElement;
                align.push(el.style.textAlign || el.getAttribute("align") || null);
              });
            }
            return { align };
          },
        },
      ],
    },
    table_row: {
      content: "table_cell+",
      allowGapCursor: false,
      toDOM: () => ["tr", 0] as const,
      parseDOM: [{ tag: "tr" }],
    },
    table_cell: {
      content: "inline*",
      isolating: true,
      toDOM: () => ["td", 0] as const,
      parseDOM: [{ tag: "td" }, { tag: "th" }],
    },
  },
  handlers: [
    {
      type: "node",
      mdastType: "table",
      pmType: "table",
      attrs: (node) => ({
        align: (node as Table).align ?? [],
      }),
      toMdast: (node, children) =>
        mdastNode({
          type: "table",
          align: node.attrs.align as (AlignType | null)[],
          children,
        }),
    },
    {
      type: "node",
      mdastType: "tableRow",
      pmType: "table_row",
      toMdast: (_node, children) => mdastNode({ type: "tableRow", children }),
    },
    {
      type: "node",
      mdastType: "tableCell",
      pmType: "table_cell",
      toMdast: (_node, children) => mdastNode({ type: "tableCell", children }),
    },
  ],
  keymap: () => ({
    Enter: tableEnter,
    Tab: tableTab,
    "Shift-Tab": tableShiftTab,
    Backspace: tableBackspace,
    Delete: tableDelete,
    ArrowUp: tableArrowUp,
    ArrowDown: tableArrowDown,
  }),
};

// ---- Table alignment decoration plugin ----

function buildAlignDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "table") {
      const align = node.attrs.align as (string | null)[];
      if (!align || align.length === 0) return false;

      let rowOffset = pos + 1; // inside table
      for (let r = 0; r < node.childCount; r++) {
        const row = node.child(r);
        let cellOffset = rowOffset + 1; // inside row
        for (let c = 0; c < row.childCount; c++) {
          const cell = row.child(c);
          const a = align[c];
          if (a) {
            decorations.push(
              Decoration.node(cellOffset, cellOffset + cell.nodeSize, {
                style: `text-align: ${a}`,
              }),
            );
          }
          cellOffset += cell.nodeSize;
        }
        rowOffset += row.nodeSize;
      }
      return false; // don't descend further into table
    }
    return true;
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * ProseMirror plugin that applies `text-align` decorations to table cells
 * based on their parent table's `align` array attribute.
 */
export function createTableAlignPlugin(): Plugin {
  return new Plugin({
    state: {
      init(_, state) {
        return buildAlignDecorations(state.doc);
      },
      apply(tr, old) {
        return tr.docChanged ? buildAlignDecorations(tr.doc) : old;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
