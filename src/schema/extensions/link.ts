import type { Link, LinkReference } from "mdast";
import type { Extension } from "../types";
import { mdastNode } from "../types";
import type { ResolvedRef } from "../lib/resolve-refs";

export const link: Extension = {
  marks: {
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      excludes: "link",
      toDOM: (mark) => [
        "a",
        {
          href: mark.attrs.href as string,
          title: mark.attrs.title as string | null,
        },
        0,
      ],
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom: HTMLElement) => ({
            href: dom.getAttribute("href"),
            title: dom.getAttribute("title"),
          }),
        },
      ],
    },
  },
  keymap: (schema) => ({
    "Mod-k": (state, dispatch, view) => {
      const { from, to, empty } = state.selection;
      const linkType = schema.marks.link;

      // --- Non-empty selection ---
      if (!empty) {
        if (state.doc.rangeHasMark(from, to, linkType)) {
          // Selection already has a link — remove it
          if (dispatch) dispatch(state.tr.removeMark(from, to, linkType));
          return true;
        }

        // Prompt for URL
        const win = view?.dom?.ownerDocument?.defaultView ?? window;
        const href = win?.prompt?.("Enter URL:");
        if (!href) return false;

        if (dispatch) dispatch(state.tr.addMark(from, to, linkType.create({ href })));
        return true;
      }

      // --- Empty selection (cursor) ---
      const existingLink = linkType.isInSet(state.doc.resolve(from).marks());

      if (existingLink) {
        // Find the full extent of the contiguous link around the cursor
        if (dispatch) {
          const $from = state.doc.resolve(from);
          const parent = $from.parent;
          const parentStart = $from.start();

          // Build contiguous link ranges inside the parent
          const ranges: Array<{ from: number; to: number }> = [];
          let current: { from: number; to: number } | null = null;

          parent.forEach((node, offset) => {
            const nStart = parentStart + offset;
            const nEnd = nStart + node.nodeSize;
            if (linkType.isInSet(node.marks)) {
              if (current && current.to === nStart) {
                current.to = nEnd;
              } else {
                current = { from: nStart, to: nEnd };
                ranges.push(current);
              }
            } else {
              current = null;
            }
          });

          const range = ranges.find((r) => r.from <= from && from <= r.to);
          if (range) {
            dispatch(state.tr.removeMark(range.from, range.to, linkType));
          }
        }
        return true;
      }

      // Cursor not inside a link, no selection — nothing to do
      return false;
    },
  }),
  handlers: [
    {
      type: "mark",
      mdastType: "link",
      pmType: "link",
      attrs: (node) => ({
        href: (node as Link).url,
        title: (node as Link).title ?? null,
      }),
      toMdast: (mark, children) =>
        mdastNode({
          type: "link",
          url: mark.attrs.href as string,
          title: mark.attrs.title as string | null,
          children,
        }),
    },
    {
      type: "mark",
      mdastType: "linkReference",
      pmType: "link",
      attrs: (node) => {
        const resolved = (node as LinkReference & { _resolved?: ResolvedRef })._resolved;
        return {
          href: resolved?.url ?? "",
          title: resolved?.title ?? null,
        };
      },
      toMdast: (mark, children) =>
        mdastNode({
          type: "link",
          url: mark.attrs.href as string,
          title: mark.attrs.title as string | null,
          children,
        }),
    },
  ],
};
