import {
  Schema,
  Slice,
  type NodeSpec,
  type MarkSpec,
  type Node as PMNode,
} from "prosemirror-model";
import { inputRules as createInputRulesPlugin } from "prosemirror-inputrules";
import { keymap as createKeymapPlugin } from "prosemirror-keymap";
import { Plugin } from "prosemirror-state";
import type { InputRule } from "prosemirror-inputrules";
import type { Root } from "mdast";

import type { ConversionHandler, MarkHandler, ProsedownSchema } from "./types";
import { fromMdast } from "./lib/from-mdast";
import { toMdast } from "./lib/to-mdast";
import { resolveReferences } from "./lib/resolve-refs";
import { processor } from "./processor";

// Extensions
import { doc } from "./extensions/doc";
import { paragraph } from "./extensions/paragraph";
import { text } from "./extensions/text";
import { heading } from "./extensions/heading";
import { blockquote } from "./extensions/blockquote";
import { codeBlock } from "./extensions/code-block";
import { horizontalRule } from "./extensions/horizontal-rule";
import { list } from "./extensions/list";
import { table, annotateTableCells } from "./extensions/table";
import { strong } from "./extensions/strong";
import { emphasis } from "./extensions/emphasis";
import { inlineCode } from "./extensions/inline-code";
import { strikethrough } from "./extensions/strikethrough";
import { link } from "./extensions/link";
import { image } from "./extensions/image";
import { hardBreak } from "./extensions/hard-break";

// All extensions in registration order.
// Node order matters for ProseMirror schema — doc must be first, text early.
const extensions = [
  doc,
  paragraph,
  text,
  heading,
  blockquote,
  codeBlock,
  horizontalRule,
  list,
  table,
  strong,
  emphasis,
  inlineCode,
  strikethrough,
  link,
  image,
  hardBreak,
];

// ---------- Build ProseMirror Schema ----------

const nodeSpecs: Record<string, NodeSpec> = {};
const markSpecs: Record<string, MarkSpec> = {};

for (const ext of extensions) {
  if (ext.nodes) {
    for (const [name, spec] of Object.entries(ext.nodes)) {
      nodeSpecs[name] = spec;
    }
  }
  if (ext.marks) {
    for (const [name, spec] of Object.entries(ext.marks)) {
      markSpecs[name] = spec;
    }
  }
}

export const schema: ProsedownSchema = new Schema({
  nodes: nodeSpecs,
  marks: markSpecs,
}) as ProsedownSchema;

// ---------- Build handler maps ----------

/** mdast type → ConversionHandler (used by from-mdast) */
const fromMdastHandlers = new Map<string, ConversionHandler>();

/** PM node name → ConversionHandler (used by to-mdast for nodes) */
const toMdastNodeHandlers = new Map<string, ConversionHandler>();

/** PM mark name → MarkHandler (used by to-mdast for marks) */
const toMdastMarkHandlers = new Map<string, MarkHandler>();

for (const ext of extensions) {
  for (const handler of ext.handlers) {
    // from-mdast: key by mdast type
    fromMdastHandlers.set(handler.mdastType, handler);

    // to-mdast: key by PM type name
    if (handler.type === "node" || handler.type === "leaf" || handler.type === "inline_node") {
      toMdastNodeHandlers.set(handler.pmType, handler);
    }
    if (handler.type === "mark") {
      toMdastMarkHandlers.set(handler.pmType, handler);
    }
  }
}

// ---------- Public API ----------

/**
 * Parse a markdown string into a ProseMirror document node.
 */
export function parseMarkdown(md: string): PMNode {
  const tree = processor.parse(md);
  const root = processor.runSync(tree) as Root;
  resolveReferences(root);
  annotateTableCells(root);
  return fromMdast(root, schema, fromMdastHandlers);
}

/**
 * Serialize a ProseMirror document node into a markdown string.
 */
export function serializeMarkdown(doc: PMNode): string {
  const root = toMdast(doc, toMdastNodeHandlers, toMdastMarkHandlers);
  return processor.stringify(root);
}

export { insertTable } from "./extensions/table";

// ---------- Plugins ----------

/**
 * Collect all input rules from extensions into a single ProseMirror plugin.
 */
export function createInputRules(): Plugin {
  const rules: InputRule[] = [];
  for (const ext of extensions) {
    if (ext.inputRules) {
      rules.push(...ext.inputRules(schema));
    }
  }
  return createInputRulesPlugin({ rules });
}

/**
 * Create one keymap plugin per extension so that overlapping key bindings
 * (e.g. Tab in code blocks, lists, and tables) chain correctly — the first
 * handler that returns `true` wins; if it returns `false` ProseMirror tries
 * the next plugin.
 */
export function createKeymaps(): Plugin[] {
  const plugins: Plugin[] = [];
  for (const ext of extensions) {
    if (ext.keymap) {
      plugins.push(createKeymapPlugin(ext.keymap(schema)));
    }
  }
  return plugins;
}

/**
 * Plugin that handles Markdown clipboard round-tripping:
 *
 * **Copy/Cut (serialization):**
 * Rich targets (Google Docs, Notion, etc.) use the `text/html` MIME which
 * ProseMirror produces by default. Plain-text targets (terminals, code
 * editors, chat inputs) receive Markdown instead of stripped text, preserving
 * formatting intent — the standard behaviour of Markdown editors.
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
 * - Ctrl+V from a web page → HTML path (unchanged)
 * - Ctrl+V from a text editor (no HTML) → Markdown → rich content
 * - Ctrl+Shift+V → ignores HTML, parses text/plain as Markdown
 * - Pasting inside a code block → raw text (handled by PM before our hook)
 */
export function createClipboardPlugin(): Plugin {
  return new Plugin({
    props: {
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

/**
 * Plugin that converts pasting a URL over selected text into a link.
 *
 * When the user has text selected and pastes a valid URL, the selected text
 * is wrapped in a link mark with the pasted URL as `href` instead of
 * replacing the selection with the URL text.
 */
export function createPastePlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event, _slice) {
        const { state } = view;
        const { from, to, empty } = state.selection;
        if (empty) return false;

        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (!text) return false;

        // Check if pasted text is a URL
        try {
          new URL(text);
        } catch {
          return false;
        }

        const linkMark = state.schema.marks.link;
        if (!linkMark) return false;

        const tr = state.tr.addMark(from, to, linkMark.create({ href: text }));
        view.dispatch(tr);
        return true;
      },
    },
  });
}

/**
 * Plugin that handles clicking on task list checkboxes.
 *
 * Clicking the `.task-checkbox` element toggles the `checked` attribute
 * on the enclosing `list_item` node.
 */
export function createTaskPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return false;
          if (!target.classList.contains("task-checkbox")) return false;

          event.preventDefault();

          const li = target.closest("li.task-list-item");
          if (!li) return false;

          const pos = view.posAtDOM(li, 0);
          const $pos = view.state.doc.resolve(pos);
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === "list_item" && node.attrs.checked != null) {
              view.dispatch(
                view.state.tr.setNodeMarkup($pos.before(d), undefined, {
                  ...node.attrs,
                  checked: !(node.attrs.checked as boolean),
                }),
              );
              return true;
            }
          }
          return false;
        },
      },
    },
  });
}
