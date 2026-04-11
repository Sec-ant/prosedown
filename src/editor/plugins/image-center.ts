import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Walk the document and add an `image-paragraph` class to any paragraph
 * whose only children are image nodes (no text).  This lets CSS center
 * standalone images while keeping mixed image+text paragraphs left-aligned.
 */
function buildImageCenterDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && node.childCount > 0) {
      let imageOnly = true;
      node.forEach((child) => {
        if (child.type.name !== "image") {
          imageOnly = false;
        }
      });

      if (imageOnly) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "image-paragraph",
          }),
        );
      }
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
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
