import { InputRule } from "prosemirror-inputrules";
import type { Extension } from "../types";

export const thematicBreakExt: Extension = {
  nodes: {
    thematic_break: {
      group: "block",
      toDOM: () => ["hr"] as const,
      parseDOM: [{ tag: "hr" }],
    },
  },
  handlers: [
    {
      type: "leaf",
      mdastType: "thematicBreak",
      pmType: "thematic_break",
      toMdast: () => ({ type: "thematicBreak" }),
    },
  ],
  inputRules: (schema) => [
    new InputRule(/^([-*_])\1{2,}$/, (state, _match, start, end) =>
      state.tr.replaceWith(start - 1, end, schema.nodes.thematic_break!.create()),
    ),
  ],
};
