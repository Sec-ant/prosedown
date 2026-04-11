import { Schema, type NodeSpec, type MarkSpec, type Node as PMNode } from "prosemirror-model";
import { inputRules as createInputRulesPlugin } from "prosemirror-inputrules";
import { keymap as createKeymapPlugin } from "prosemirror-keymap";
import type { Plugin } from "prosemirror-state";
import type { InputRule } from "prosemirror-inputrules";
import type { Root } from "mdast";

import type { ConversionHandler, MarkHandler, ProsedownSchema } from "./types";
import { fromMdast } from "./convert/from-mdast";
import { toMdast } from "./convert/to-mdast";
import { resolveReferences } from "./convert/resolve-refs";
import { processor } from "./processor";

// Extensions
import { docExt } from "./extensions/doc";
import { paragraphExt } from "./extensions/paragraph";
import { textExt } from "./extensions/text";
import { headingExt } from "./extensions/heading";
import { blockquoteExt } from "./extensions/blockquote";
import { codeExt } from "./extensions/code";
import { thematicBreakExt } from "./extensions/thematic-break";
import { listExt } from "./extensions/list";
import { tableExt } from "./extensions/table";
import { strongExt } from "./extensions/strong";
import { emphasisExt } from "./extensions/emphasis";
import { inlineCodeExt } from "./extensions/inline-code";
import { deleteExt } from "./extensions/delete";
import { highlightExt } from "./extensions/highlight";
import { linkExt } from "./extensions/link";
import { imageExt } from "./extensions/image";
import { breakExt } from "./extensions/break";

// All extensions in registration order.
// Node order matters for ProseMirror schema — doc must be first, text early.
const extensions = [
  docExt,
  paragraphExt,
  textExt,
  headingExt,
  blockquoteExt,
  codeExt,
  thematicBreakExt,
  listExt,
  tableExt,
  strongExt,
  emphasisExt,
  inlineCodeExt,
  deleteExt,
  highlightExt,
  linkExt,
  imageExt,
  breakExt,
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
  return fromMdast(root, schema, fromMdastHandlers);
}

/**
 * Serialize a ProseMirror document node into a markdown string.
 */
export function serializeMarkdown(doc: PMNode): string {
  const root = toMdast(doc, toMdastNodeHandlers, toMdastMarkHandlers);
  return processor.stringify(root);
}

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
