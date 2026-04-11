import { textblockTypeInputRule } from "prosemirror-inputrules";
import { setBlockType } from "prosemirror-commands";
import type { Heading as MdastHeading } from "mdast";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const headingExt: Extension = {
  nodes: {
    heading: {
      content: "(text | image)*",
      group: "block",
      defining: true,
      attrs: { depth: { default: 1, validate: "number" } },
      toDOM: (node) => [`h${node.attrs.depth}`, 0] as const,
      parseDOM: [1, 2, 3, 4, 5, 6].map((depth) => ({
        tag: `h${depth}`,
        attrs: { depth },
      })),
    },
  },
  handlers: [
    {
      type: "node",
      mdastType: "heading",
      pmType: "heading",
      attrs: (node) => ({ depth: (node as MdastHeading).depth }),
      toMdast: (node, children) =>
        mdastNode({
          type: "heading",
          depth: node.attrs.depth as MdastHeading["depth"],
          children,
        }),
    },
  ],
  inputRules: (schema) => [
    textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (m) => ({
      depth: m[1]!.length,
    })),
  ],
  keymap: (schema) => ({
    "Mod-Shift-1": setBlockType(schema.nodes.heading, { depth: 1 }),
    "Mod-Shift-2": setBlockType(schema.nodes.heading, { depth: 2 }),
    "Mod-Shift-3": setBlockType(schema.nodes.heading, { depth: 3 }),
    "Mod-Shift-4": setBlockType(schema.nodes.heading, { depth: 4 }),
    "Mod-Shift-5": setBlockType(schema.nodes.heading, { depth: 5 }),
    "Mod-Shift-6": setBlockType(schema.nodes.heading, { depth: 6 }),
  }),
};
