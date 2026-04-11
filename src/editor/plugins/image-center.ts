import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

function isImageOnly(node: PMNode): boolean {
  if (node.childCount === 0) return false;

  let imageOnly = true;
  node.forEach((child) => {
    if (child.type.name !== "image") {
      imageOnly = false;
    }
  });

  return imageOnly;
}

/**
 * Walk the document and mark any paragraph with `data-image-only`
 * whose only children are image nodes (no text).  This lets CSS center
 * standalone images while keeping mixed image+text paragraphs left-aligned.
 */
function buildImageCenterDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && isImageOnly(node)) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          "data-image-only": "true",
        }),
      );
      return false;
    }
    return true;
  });

  return DecorationSet.create(doc, decorations);
}

export function createImageCenterPlugin(): Plugin {
  return new Plugin({
    state: {
      init(_, state) {
        return buildImageCenterDecorations(state.doc);
      },
      apply(tr, old) {
        return tr.docChanged ? buildImageCenterDecorations(tr.doc) : old;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const paragraph = newState.schema.nodes.paragraph;
      if (!paragraph) return null;

      let tr = newState.tr;
      newState.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && isImageOnly(node)) {
          tr = tr.setNodeMarkup(pos, paragraph);
          return false;
        }
        return true;
      });

      return tr.docChanged ? tr : null;
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
