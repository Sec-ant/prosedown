import type { Node as PMNode, Mark } from "prosemirror-model";
import type { Root, RootContent } from "mdast";
import type {
  ConversionHandler,
  LeafHandler,
  InlineNodeHandler,
  NodeHandler,
  MarkHandler,
  MdastContent,
} from "../types";
import { mergeAdjacentWrappers } from "./merge-wrappers";

/**
 * Convert a ProseMirror document node into an mdast Root.
 *
 * For text nodes with marks, marks are converted inside-out into mdast
 * wrapper nodes. Mark ordering is determined by ProseMirror's canonical
 * mark order (deterministic, unlike prosemirror-unified).
 */
export function toMdast(
  doc: PMNode,
  handlers: ReadonlyMap<string, ConversionHandler>,
  markHandlers: ReadonlyMap<string, MarkHandler>,
): Root {
  const children = serializeChildren(doc, handlers, markHandlers);
  return { type: "root", children: children as RootContent[] };
}

function serializeNode(
  node: PMNode,
  handlers: ReadonlyMap<string, ConversionHandler>,
  markHandlers: ReadonlyMap<string, MarkHandler>,
): MdastContent[] {
  const handler = handlers.get(node.type.name) as
    | NodeHandler
    | LeafHandler
    | InlineNodeHandler
    | undefined;

  if (!handler) {
    // Skip unknown node types
    return [];
  }

  switch (handler.type) {
    case "leaf":
      return [handler.toMdast(node)];

    case "inline_node":
      return [handler.toMdast(node)];

    case "node": {
      const children = serializeChildren(node, handlers, markHandlers);
      return [handler.toMdast(node, children)];
    }

    default: {
      const exhaustiveCheck: never = handler;
      return exhaustiveCheck;
    }
  }
}

function serializeChildren(
  parent: PMNode,
  handlers: ReadonlyMap<string, ConversionHandler>,
  markHandlers: ReadonlyMap<string, MarkHandler>,
): MdastContent[] {
  const result: MdastContent[] = [];

  parent.forEach((child) => {
    if (child.isText && child.text) {
      // Text node: wrap with mark nodes from inside out
      let mdastNode: MdastContent = { type: "text", value: child.text };
      mdastNode = applyMarks(mdastNode, child.marks, markHandlers);
      result.push(mdastNode);
    } else if (child.isText) {
      // Empty text node — skip
    } else {
      // Non-text node: check if it has marks (e.g. inline nodes like image)
      const nodes = serializeNode(child, handlers, markHandlers);
      for (const mdastNode of nodes) {
        result.push(applyMarks(mdastNode, child.marks, markHandlers));
      }
    }
  });

  return mergeAdjacentWrappers(result);
}

/**
 * Wrap an mdast node with mark wrapper nodes, from inside out.
 * Mark order comes from ProseMirror's canonical ordering (deterministic).
 */
function applyMarks(
  node: MdastContent,
  marks: readonly Mark[],
  markHandlers: ReadonlyMap<string, MarkHandler>,
): MdastContent {
  let wrapped = node;

  for (const mark of marks) {
    const handler = markHandlers.get(mark.type.name);
    if (handler) {
      wrapped = handler.toMdast(mark, [wrapped]);
    }
  }

  return wrapped;
}
