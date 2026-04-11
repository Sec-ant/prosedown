import { DOMSerializer, Slice, type Node as PMNode, type Schema } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

import { parseMarkdown, schema, serializeMarkdown } from "../../markdown";

/**
 * Create a custom DOMSerializer for clipboard HTML that renders table
 * headers as `<th>` elements (first row) with alignment styles.
 */
export function createTableClipboardSerializer(s: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(s);
  const nodes = { ...base.nodes };

  nodes.table = (node: PMNode) => {
    const align = (node.attrs.align as (string | null)[]) || [];
    const tableEl = document.createElement("table");

    let rowIndex = 0;
    node.forEach((row) => {
      const tr = document.createElement("tr");
      let colIndex = 0;
      row.forEach((cell) => {
        const tag = rowIndex === 0 ? "th" : "td";
        const cellEl = document.createElement(tag);
        const alignment = align[colIndex];
        if (alignment) {
          cellEl.style.textAlign = alignment;
        }
        cellEl.appendChild(base.serializeFragment(cell.content));
        tr.appendChild(cellEl);
        colIndex++;
      });
      tableEl.appendChild(tr);
      rowIndex++;
    });

    return tableEl;
  };

  return new DOMSerializer(nodes, base.marks);
}

/**
 * Plugin that handles Markdown clipboard round-tripping:
 *
 * **Copy/Cut (serialization):**
 * Rich targets (Google Docs, Notion, etc.) use the `text/html` MIME which
 * ProseMirror produces by default. Plain-text targets (terminals, code
 * editors, chat inputs) receive Markdown instead of stripped text, preserving
 * formatting intent - the standard behaviour of Markdown editors.
 *
 * Special case: when the selection is entirely inside a code block
 * (`openStart > 0` on a single code-typed node), we return the raw text
 * content without fences so that copy/paste within code blocks works as
 * users expect.
 *
 * **Paste (parsing):**
 * When pasting plain text (either because the clipboard has no HTML, or
 * because the user pressed Ctrl+Shift+V), we parse it as Markdown and
 * insert rich content. This means:
 * - Ctrl+V from a web page -> HTML path (unchanged)
 * - Ctrl+V from a text editor (no HTML) -> Markdown -> rich content
 * - Ctrl+Shift+V -> ignores HTML, parses text/plain as Markdown
 * - Pasting inside a code block -> raw text (handled by PM before our hook)
 */
export function createClipboardPlugin(): Plugin {
  return new Plugin({
    props: {
      clipboardSerializer: createTableClipboardSerializer(schema),

      clipboardTextSerializer(slice: Slice): string {
        const first = slice.content.firstChild;
        if (slice.openStart > 0 && slice.content.childCount === 1 && first?.type.spec.code) {
          return first.textContent;
        }
        const doc = schema.node("doc", null, slice.content);
        return serializeMarkdown(doc).trimEnd();
      },

      clipboardTextParser(text) {
        const doc = parseMarkdown(text);
        return new Slice(doc.content, 0, 0);
      },
    },
  });
}
