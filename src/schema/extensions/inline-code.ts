import { toggleMark } from "prosemirror-commands";
import { markInputRule } from "../lib/mark-input-rule";
import type { Extension } from "../types";

export const inlineCode: Extension = {
  marks: {
    code: {
      code: true,
      excludes: "_",
      toDOM: () => ["code", 0] as const,
      parseDOM: [{ tag: "code" }],
    },
  },
  handlers: [
    {
      type: "mark",
      mdastType: "inlineCode",
      pmType: "code",
      toMdast: (_mark, children) => ({
        type: "inlineCode",
        value: children
          .map((c) => ("value" in c && typeof c.value === "string" ? c.value : ""))
          .join(""),
      }),
    },
  ],
  inputRules: (schema) => [markInputRule(/`([^\s`](?:.*[^\s`])?)`(.)$/, schema.marks.code)],
  keymap: (schema) => ({
    "Mod-e": toggleMark(schema.marks.code),
  }),
};
