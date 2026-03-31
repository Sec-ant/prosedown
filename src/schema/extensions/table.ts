import type { AlignType, Nodes, Table, TableCell } from "mdast";
import { TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { ResolvedPos } from "prosemirror-model";
import type { Extension } from "../types";
import { mdastNode } from "../types";

/** TableCell with preprocessing metadata added by `annotateTableCells()`. */
interface AnnotatedTableCell extends TableCell {
  _isHeader?: boolean;
  _align?: AlignType | null;
}

/**
 * Walk an mdast tree and annotate `tableCell` nodes with:
 * - `_isHeader`: true if the cell is in the first row of a table
 * - `_align`: the column alignment from the parent table's `align` array
 */
export function annotateTableCells(root: Nodes): void {
  visitTables(root);
}

function visitTables(node: Nodes): void {
  if (node.type === "table") {
    const table = node as Table;
    const align = table.align ?? [];
    const children = table.children;
    for (let rowIdx = 0; rowIdx < children.length; rowIdx++) {
      const row = children[rowIdx]!;
      for (let colIdx = 0; colIdx < row.children.length; colIdx++) {
        const cell = row.children[colIdx]! as AnnotatedTableCell;
        cell._isHeader = rowIdx === 0;
        cell._align = align[colIdx] ?? null;
      }
    }
  }

  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children as Nodes[]) {
      visitTables(child);
    }
  }
}

// ---- Table cell navigation helpers ----

/** Find the depth of the enclosing table cell (table_cell or table_header). */
function findCellDepth($pos: ResolvedPos): number | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "table_cell" || node.type.name === "table_header") {
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
 * Insert a 3×2 table (1 header row + 1 data row) and place the cursor
 * in the first header cell.
 */
export function insertTable(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { table: tbl, table_row: row, table_header: th, table_cell: td } = state.schema.nodes;
  if (!tbl || !row || !th || !td) return false;

  if (dispatch) {
    const { $from } = state.selection;
    const headerCells = [];
    const dataCells = [];
    for (let i = 0; i < 3; i++) {
      headerCells.push(th.createAndFill()!);
      dataCells.push(td.createAndFill()!);
    }
    const headerRow = row.create(null, headerCells);
    const dataRow = row.create(null, dataCells);
    const tableNode = tbl.create(null, [headerRow, dataRow]);

    const insertPos = $from.after(1); // after current top-level block
    const tr = state.tr.insert(insertPos, tableNode);
    // table open + row open + cell open = 3 positions from insertPos
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 3));
    dispatch(tr);
  }
  return true;
}

export const table: Extension = {
  nodes: {
    table: {
      content: "table_row+",
      group: "block",
      isolating: true,
      allowGapCursor: false,
      toDOM: () => ["table", ["tbody", 0]] as const,
      parseDOM: [{ tag: "table" }],
    },
    table_row: {
      content: "(table_cell | table_header)+",
      allowGapCursor: false,
      toDOM: () => ["tr", 0] as const,
      parseDOM: [{ tag: "tr" }],
    },
    table_header: {
      content: "inline*",
      attrs: { align: { default: null } },
      isolating: true,
      toDOM: (node) => {
        const align = node.attrs.align as string | null;
        return align
          ? (["th", { style: `text-align: ${align}` }, 0] as const)
          : (["th", 0] as const);
      },
      parseDOM: [
        {
          tag: "th",
          getAttrs: (dom: HTMLElement) => ({
            align: dom.style.textAlign || dom.getAttribute("align") || null,
          }),
        },
      ],
    },
    table_cell: {
      content: "inline*",
      attrs: { align: { default: null } },
      isolating: true,
      toDOM: (node) => {
        const align = node.attrs.align as string | null;
        return align
          ? (["td", { style: `text-align: ${align}` }, 0] as const)
          : (["td", 0] as const);
      },
      parseDOM: [
        {
          tag: "td",
          getAttrs: (dom: HTMLElement) => ({
            align: dom.style.textAlign || dom.getAttribute("align") || null,
          }),
        },
      ],
    },
  },
  handlers: [
    {
      type: "node",
      mdastType: "table",
      pmType: "table",
      toMdast: (node, children) => {
        const align: (AlignType | null)[] = [];
        const firstRow = node.firstChild;
        if (firstRow) {
          firstRow.forEach((cell) => {
            align.push((cell.attrs.align as AlignType | null) ?? null);
          });
        }
        return mdastNode({
          type: "table",
          align,
          children,
        });
      },
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
      resolvePmType: (node) =>
        (node as AnnotatedTableCell)._isHeader ? "table_header" : "table_cell",
      attrs: (node) => ({
        align: (node as AnnotatedTableCell)._align ?? null,
      }),
      toMdast: (_node, children) => mdastNode({ type: "tableCell", children }),
    },
    {
      type: "node",
      mdastType: "tableCell:header_toMdast",
      pmType: "table_header",
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
