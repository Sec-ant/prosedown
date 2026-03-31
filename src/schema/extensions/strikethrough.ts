import { toggleMark } from "prosemirror-commands";
import { markInputRule } from "../lib/mark-input-rule";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const strikethrough: Extension = {
  marks: {
    strikethrough: {
      toDOM: () => ["del", 0] as const,
      parseDOM: [{ tag: "del" }, { tag: "s" }, { style: "text-decoration=line-through" }],
    },
  },
  handlers: [
    {
      type: "mark",
      mdastType: "delete",
      pmType: "strikethrough",
      toMdast: (_mark, children) => mdastNode({ type: "delete", children }),
    },
  ],
  inputRules: (schema) => [
    markInputRule(/~~([^\s](?:.*[^\s])?)~~(.)$/, schema.marks.strikethrough),
  ],
  keymap: (schema) => ({
    "Mod-Shift-x": toggleMark(schema.marks.strikethrough),
  }),
};
