import type { MdastContent } from "../types";

type MdastParent = MdastContent & { children: MdastContent[] };

/**
 * Merge adjacent mdast wrapper nodes of the same type.
 *
 * When converting PM → mdast, each text node with marks produces its own
 * wrapper chain. E.g. two adjacent bold text nodes become:
 *   strong > text("a"), strong > text("b")
 * This function merges them into:
 *   strong > [text("a"), text("b")]
 */
export function mergeAdjacentWrappers(nodes: MdastContent[]): MdastContent[] {
  if (nodes.length <= 1) return nodes;

  const result: MdastContent[] = [nodes[0]!];

  for (let i = 1; i < nodes.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = nodes[i]!;

    if (canMerge(prev, curr) && isMdastParent(prev) && isMdastParent(curr)) {
      // Merge children into the previous wrapper
      const prevChildren = prev.children;
      const currChildren = curr.children;
      prev.children = mergeAdjacentWrappers([...prevChildren, ...currChildren]);
    } else {
      result.push(curr);
    }
  }

  return result;
}

/**
 * Only inline mark wrapper types should be merged.
 * Structural nodes (listItem, paragraph, heading, tableRow, etc.) must never
 * be merged even when they appear adjacent with the same type.
 */
const MERGEABLE_TYPES = new Set(["strong", "emphasis", "delete", "link"]);

/**
 * Two wrapper nodes can merge if they are inline mark wrappers of the same
 * type and (for marks with attrs like links) share the same attributes.
 */
function canMerge(a: MdastContent, b: MdastContent): boolean {
  if (a.type !== b.type) return false;
  if (!MERGEABLE_TYPES.has(a.type)) return false;
  if (!isMdastParent(a) || !isMdastParent(b)) return false;

  // For link nodes, also compare url and title
  if (a.type === "link" && b.type === "link") {
    return a.url === b.url && (a.title ?? null) === (b.title ?? null);
  }

  return true;
}

function isMdastParent(node: MdastContent): node is MdastParent {
  return "children" in node && Array.isArray(node.children);
}
