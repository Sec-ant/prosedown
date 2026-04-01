import { toggleMark } from "prosemirror-commands";
import { markInputRule } from "../lib/mark-input-rule";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const highlightExt: Extension = {
  marks: {
    highlight: {
      toDOM: () => ["mark", 0] as const,
      parseDOM: [{ tag: "mark" }],
    },
  },
  handlers: [
    {
      type: "mark",
      mdastType: "highlight",
      pmType: "highlight",
      toMdast: (_mark, children) => mdastNode({ type: "highlight", children }),
    },
  ],
  inputRules: (schema) => [markInputRule(/==([^\s](?:.*[^\s])?)==(.)$/, schema.marks.highlight)],
  keymap: (schema) => ({
    "Mod-Shift-h": toggleMark(schema.marks.highlight),
  }),
};
