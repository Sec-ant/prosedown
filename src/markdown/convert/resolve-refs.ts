import type { Root, Definition, LinkReference, ImageReference } from "mdast";
import { visit } from "unist-util-visit";

export interface ResolvedRef {
  url: string;
  title: string | null;
}

/** A reference node annotated with resolved definition data. */
export type AnnotatedReference = (LinkReference | ImageReference) & { _resolved?: ResolvedRef };

/**
 * Pre-process an mdast tree: collect `definition` nodes and annotate
 * `linkReference` / `imageReference` nodes with resolved URLs.
 *
 * This avoids the mutation-of-immutable-PM-objects hack used by
 * prosemirror-unified.
 */
export function resolveReferences(root: Root): void {
  const defs = new Map<string, ResolvedRef>();

  // Pass 1: collect definitions
  visit(root, "definition", (node: Definition) => {
    defs.set(node.identifier.toLowerCase(), {
      url: node.url,
      title: node.title ?? null,
    });
  });

  // Pass 2: annotate references
  visit(root, (node) => {
    if (node.type === "linkReference" || node.type === "imageReference") {
      const ref = node as AnnotatedReference;
      const def = defs.get(ref.identifier.toLowerCase());
      if (def) {
        ref._resolved = def;
      }
    }
  });
}
