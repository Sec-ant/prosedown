import type { Mark, MarkSpec, Node as PMNode, NodeSpec, Schema } from "prosemirror-model";
import type { InputRule } from "prosemirror-inputrules";
import type { Command } from "prosemirror-state";
import type { RootContent, PhrasingContent } from "mdast";

// ----- Schema name types -----

/** All ProseMirror node names registered by extensions. */
export type NodeName =
  | "doc"
  | "paragraph"
  | "text"
  | "heading"
  | "blockquote"
  | "code"
  | "thematic_break"
  | "list"
  | "list_item"
  | "table"
  | "table_row"
  | "table_cell"
  | "image"
  | "break";

/** All ProseMirror mark names registered by extensions. */
export type MarkName = "strong" | "emphasis" | "inline_code" | "delete" | "highlight" | "link";

/** The concrete Schema type for this project's editor. */
export type ProsedownSchema = Schema<NodeName, MarkName>;

// ----- mdast utility type -----

/** Any mdast content node (not Root itself) */
export type MdastContent = RootContent | PhrasingContent;

/** Real mdast types plus internal synthetic routing keys used during PM -> mdast conversion. */
export type HandlerMdastType = MdastContent["type"] | `${MdastContent["type"]}:${string}`;

/**
 * Type-safe factory for mdast content nodes.
 *
 * Centralizes the type assertion needed because our handler framework passes
 * `MdastContent[]` as children, while mdast's specific node types declare
 * narrower child arrays (e.g., `BlockContent[]` for Blockquote).
 *
 * The `type` discriminant is validated at compile time against all known
 * mdast content types, catching typos like `"paragrap"` or `"strng"`.
 */
export function mdastNode<T extends MdastContent["type"]>(
  node: { type: T } & Record<string, unknown>,
): MdastContent {
  // Safe: `type` discriminant is compile-time validated; the only mismatch
  // is children array width (MdastContent[] vs narrower mdast subtypes).
  return node as unknown as MdastContent;
}

// ----- Handler types -----

/** mdast Parent → PM node (blockquote, paragraph, heading, list, etc.) */
export interface NodeHandler {
  readonly type: "node";
  readonly mdastType: HandlerMdastType;
  readonly pmType: NodeName;
  readonly attrs?: (mdast: MdastContent) => Record<string, unknown>;
  readonly toMdast: (node: PMNode, children: MdastContent[]) => MdastContent;
}

/** mdast Parent → PM mark (emphasis, strong, link, delete, etc.) */
export interface MarkHandler {
  readonly type: "mark";
  readonly mdastType: HandlerMdastType;
  readonly pmType: MarkName;
  readonly attrs?: (mdast: MdastContent) => Record<string, unknown>;
  readonly toMdast: (mark: Mark, children: MdastContent[]) => MdastContent;
}

/** mdast Literal/Void → PM leaf node (code, thematic_break, etc.) */
export interface LeafHandler {
  readonly type: "leaf";
  readonly mdastType: HandlerMdastType;
  readonly pmType: NodeName;
  readonly attrs?: (mdast: MdastContent) => Record<string, unknown>;
  readonly toMdast: (node: PMNode) => MdastContent;
}

/** mdast Void → PM inline node (image, break, etc.) */
export interface InlineNodeHandler {
  readonly type: "inline_node";
  readonly mdastType: HandlerMdastType;
  readonly pmType: NodeName;
  readonly attrs?: (mdast: MdastContent) => Record<string, unknown>;
  readonly toMdast: (node: PMNode) => MdastContent;
}

export type ConversionHandler = NodeHandler | MarkHandler | LeafHandler | InlineNodeHandler;

// ----- Extension -----

export interface Extension {
  /** Node specs to add to the ProseMirror schema. */
  readonly nodes?: Record<string, NodeSpec>;
  /** Mark specs to add to the ProseMirror schema. */
  readonly marks?: Record<string, MarkSpec>;
  /** Handlers mapping mdast ↔ PM for this extension's node/mark types. */
  readonly handlers: readonly ConversionHandler[];
  /** ProseMirror input rules (e.g. `# ` → heading). */
  readonly inputRules?: (schema: ProsedownSchema) => InputRule[];
  /** ProseMirror keymap bindings. */
  readonly keymap?: (schema: ProsedownSchema) => Record<string, Command>;
}
