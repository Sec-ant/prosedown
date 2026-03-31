import { textblockTypeInputRule } from "prosemirror-inputrules";
import { setBlockType } from "prosemirror-commands";
import type { Heading as MdastHeading } from "mdast";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const heading: Extension = {
  nodes: {
    heading: {
      content: "(text | image)*",
      group: "block",
      defining: true,
      attrs: { level: { default: 1, validate: "number" } },
      toDOM: (node) => [`h${node.attrs.level}`, 0] as const,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        attrs: { level },
      })),
    },
  },
  handlers: [
    {
      type: "node",
      mdastType: "heading",
      pmType: "heading",
      attrs: (node) => ({ level: (node as MdastHeading).depth }),
      toMdast: (node, children) =>
        mdastNode({
          type: "heading",
          depth: node.attrs.level as MdastHeading["depth"],
          children,
        }),
    },
  ],
  inputRules: (schema) => [
    textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (m) => ({
      level: m[1]!.length,
    })),
  ],
  keymap: (schema) => ({
    "Mod-Shift-1": setBlockType(schema.nodes.heading, { level: 1 }),
    "Mod-Shift-2": setBlockType(schema.nodes.heading, { level: 2 }),
    "Mod-Shift-3": setBlockType(schema.nodes.heading, { level: 3 }),
    "Mod-Shift-4": setBlockType(schema.nodes.heading, { level: 4 }),
    "Mod-Shift-5": setBlockType(schema.nodes.heading, { level: 5 }),
    "Mod-Shift-6": setBlockType(schema.nodes.heading, { level: 6 }),
  }),
};
