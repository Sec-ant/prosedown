import { toggleMark } from "prosemirror-commands";
import { markInputRule } from "../lib/mark-input-rule";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const emphasis: Extension = {
  marks: {
    em: {
      toDOM: () => ["em", 0] as const,
      parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
    },
  },
  handlers: [
    {
      type: "mark",
      mdastType: "emphasis",
      pmType: "em",
      toMdast: (_mark, children) => mdastNode({ type: "emphasis", children }),
    },
  ],
  inputRules: (schema) => [
    // Negative lookbehind prevents matching inside **bold** delimiters
    markInputRule(/(?<!\*)\*([^\s*](?:.*[^\s*])?)\*(.)$/, schema.marks.em),
    markInputRule(/(?<!_)_([^\s_](?:.*[^\s_])?)_(.)$/, schema.marks.em),
  ],
  keymap: (schema) => ({
    "Mod-i": toggleMark(schema.marks.em),
  }),
};
