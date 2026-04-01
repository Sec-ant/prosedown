import { chainCommands, exitCode } from "prosemirror-commands";
import type { Command } from "prosemirror-state";
import type { Extension, ProsedownSchema } from "../types";

const insertHardBreak: (schema: ProsedownSchema) => Command = (schema) => (state, dispatch) => {
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(schema.nodes.break.create()).scrollIntoView());
  }
  return true;
};

export const breakExt: Extension = {
  nodes: {
    break: {
      inline: true,
      group: "inline",
      selectable: false,
      toDOM: () => ["br"] as const,
      parseDOM: [{ tag: "br" }],
    },
  },
  handlers: [
    {
      type: "inline_node",
      mdastType: "break",
      pmType: "break",
      toMdast: () => ({ type: "break" }),
    },
  ],
  keymap: (schema) => ({
    "Shift-Enter": chainCommands(exitCode, insertHardBreak(schema)),
  }),
};
