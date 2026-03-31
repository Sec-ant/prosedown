import type { Image, ImageReference } from "mdast";
import type { Extension } from "../types";
import type { ResolvedRef } from "../lib/resolve-refs";

export const image: Extension = {
  nodes: {
    image: {
      inline: true,
      group: "inline",
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
      },
      toDOM: (node) => [
        "img",
        {
          src: node.attrs.src as string,
          alt: node.attrs.alt as string,
          title: node.attrs.title as string | null,
        },
      ],
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (dom: HTMLElement) => ({
            src: dom.getAttribute("src"),
            alt: dom.getAttribute("alt"),
            title: dom.getAttribute("title"),
          }),
        },
      ],
    },
  },
  handlers: [
    {
      type: "inline_node",
      mdastType: "image",
      pmType: "image",
      attrs: (node) => ({
        src: (node as Image).url,
        alt: (node as Image).alt ?? null,
        title: (node as Image).title ?? null,
      }),
      toMdast: (node) => ({
        type: "image",
        url: node.attrs.src as string,
        alt: node.attrs.alt as string | null,
        title: node.attrs.title as string | null,
      }),
    },
    {
      type: "inline_node",
      mdastType: "imageReference",
      pmType: "image",
      attrs: (node) => {
        const resolved = (node as ImageReference & { _resolved?: ResolvedRef })._resolved;
        return {
          src: resolved?.url ?? "",
          alt: (node as ImageReference).alt ?? null,
          title: resolved?.title ?? null,
        };
      },
      toMdast: (node) => ({
        type: "image",
        url: node.attrs.src as string,
        alt: node.attrs.alt as string | null,
        title: node.attrs.title as string | null,
      }),
    },
  ],
};
