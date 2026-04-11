import type { Node as PMNode } from "prosemirror-model";
import type { Root } from "mdast";
import type { ConversionHandler, MdastContent, ProsedownSchema } from "../types";

/**
 * Convert an mdast Root into a ProseMirror document node.
 *
 * Handler dispatch is O(1) via Map lookup on `node.type`.
 * The `type` discriminant on each handler determines how conversion proceeds:
 * - "node": recursively convert children, create PM node
 * - "mark": recursively convert children, auto-apply PM mark to each child
 * - "leaf": extract literal value as text content
 * - "inline_node": create PM inline node from attrs
 */
export function fromMdast(
  root: Root,
  schema: ProsedownSchema,
  handlers: ReadonlyMap<string, ConversionHandler>,
): PMNode {
  const children = convertChildren(root, schema, handlers);
  const doc = schema.nodes.doc.createAndFill(null, children);
  if (!doc) {
    throw new Error("Failed to create doc node from mdast");
  }
  return doc;
}

function convertNode(
  node: MdastContent,
  schema: ProsedownSchema,
  handlers: ReadonlyMap<string, ConversionHandler>,
): PMNode[] {
  // ProseMirror text nodes are special — they can't be created via createAndFill.
  // Handle mdast text nodes directly.
  if (node.type === "text" && "value" in node && typeof node.value === "string") {
    return node.value ? [schema.text(node.value)] : [];
  }

  const handler = handlers.get(node.type);

  if (!handler) {
    // Skip unknown node types (e.g. definition, html, yaml)
    return [];
  }

  switch (handler.type) {
    case "node": {
      const children = convertChildren(node, schema, handlers);
      const attrs = handler.attrs?.(node) ?? null;
      const pmNode = schema.nodes[handler.pmType].createAndFill(attrs, children);
      return pmNode ? [pmNode] : [];
    }

    case "mark": {
      const attrs = handler.attrs?.(node) ?? null;
      const mark = schema.marks[handler.pmType].create(attrs);

      // Literal marks (e.g. inlineCode): node has `value` instead of `children`
      if ("value" in node && typeof node.value === "string") {
        const text = schema.text(node.value, [mark]);
        return [text];
      }

      const children = convertChildren(node, schema, handlers);
      // Framework auto-applies mark to each child — no per-extension boilerplate
      return children.map((child) => child.mark(mark.addToSet(child.marks)));
    }

    case "leaf": {
      const attrs = handler.attrs?.(node) ?? null;
      const value = "value" in node && typeof node.value === "string" ? node.value : "";
      const content = value ? [schema.text(value)] : [];
      const pmNode = schema.nodes[handler.pmType].createAndFill(attrs, content);
      return pmNode ? [pmNode] : [];
    }

    case "inline_node": {
      const attrs = handler.attrs?.(node) ?? null;
      const pmNode = schema.nodes[handler.pmType].createAndFill(attrs);
      return pmNode ? [pmNode] : [];
    }

    default: {
      const exhaustiveCheck: never = handler;
      return exhaustiveCheck;
    }
  }
}

function convertChildren(
  node: Root | MdastContent,
  schema: ProsedownSchema,
  handlers: ReadonlyMap<string, ConversionHandler>,
): PMNode[] {
  if (!("children" in node) || !Array.isArray(node.children) || node.children.length === 0) {
    return [];
  }
  return (node.children as MdastContent[]).flatMap((child) => convertNode(child, schema, handlers));
}
