import { toggleMark } from "prosemirror-commands";
import { markInputRule } from "../input/mark-input-rule";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const emphasisExt: Extension = {
  marks: {
    emphasis: {
      toDOM: () => ["em", 0] as const,
      parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
    },
  },
  handlers: [
    {
      type: "mark",
      mdastType: "emphasis",
      pmType: "emphasis",
      toMdast: (_mark, children) => mdastNode({ type: "emphasis", children }),
    },
  ],
  inputRules: (schema) => [
    // Negative lookbehind prevents matching inside **bold** delimiters
    markInputRule(/(?<!\*)\*([^\s*](?:.*[^\s*])?)\*(.)$/, schema.marks.emphasis),
    markInputRule(/(?<!_)_([^\s_](?:.*[^\s_])?)_(.)$/, schema.marks.emphasis),
  ],
  keymap: (schema) => ({
    "Mod-i": toggleMark(schema.marks.emphasis),
  }),
};
