import { toggleMark } from "prosemirror-commands";
import { markInputRule } from "../input/mark-input-rule";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const deleteExt: Extension = {
  marks: {
    delete: {
      toDOM: () => ["del", 0] as const,
      parseDOM: [{ tag: "del" }, { tag: "s" }, { style: "text-decoration=line-through" }],
    },
  },
  handlers: [
    {
      type: "mark",
      mdastType: "delete",
      pmType: "delete",
      toMdast: (_mark, children) => mdastNode({ type: "delete", children }),
    },
  ],
  inputRules: (schema) => [markInputRule(/~~([^\s](?:.*[^\s])?)~~(.)$/, schema.marks.delete)],
  keymap: (schema) => ({
    "Mod-Shift-x": toggleMark(schema.marks.delete),
  }),
};
