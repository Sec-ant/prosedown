import type { Image, ImageReference } from "mdast";
import type { Extension } from "../types";
import type { ResolvedRef } from "../convert/resolve-refs";

export const imageExt: Extension = {
  nodes: {
    image: {
      inline: true,
      group: "inline",
      attrs: {
        url: {},
        alt: { default: "" },
        title: { default: null },
      },
      toDOM: (node) => [
        "img",
        {
          src: node.attrs.url as string,
          alt: node.attrs.alt as string,
          title: node.attrs.title as string | null,
        },
      ],
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (dom: HTMLElement) => ({
            url: dom.getAttribute("src"),
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
        url: (node as Image).url,
        alt: (node as Image).alt ?? null,
        title: (node as Image).title ?? null,
      }),
      toMdast: (node) => ({
        type: "image",
        url: node.attrs.url as string,
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
          url: resolved?.url ?? "",
          alt: (node as ImageReference).alt ?? null,
          title: resolved?.title ?? null,
        };
      },
      toMdast: (node) => ({
        type: "image",
        url: node.attrs.url as string,
        alt: node.attrs.alt as string | null,
        title: node.attrs.title as string | null,
      }),
    },
  ],
};
