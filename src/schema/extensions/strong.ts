import { toggleMark } from "prosemirror-commands";
import { markInputRule } from "../lib/mark-input-rule";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const strong: Extension = {
  marks: {
    strong: {
      toDOM: () => ["strong", 0] as const,
      parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }],
    },
  },
  handlers: [
    {
      type: "mark",
      mdastType: "strong",
      pmType: "strong",
      toMdast: (_mark, children) => mdastNode({ type: "strong", children }),
    },
  ],
  inputRules: (schema) => [
    markInputRule(/\*\*([^\s](?:.*[^\s])?)\*\*(.)$/, schema.marks.strong),
    markInputRule(/__([^\s](?:.*[^\s])?)__(.)$/, schema.marks.strong),
  ],
  keymap: (schema) => ({
    "Mod-b": toggleMark(schema.marks.strong),
  }),
};
