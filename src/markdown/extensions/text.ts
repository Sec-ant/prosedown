import type { Extension } from "../types";

export const textExt: Extension = {
  nodes: {
    text: { group: "inline" },
  },
  handlers: [
    {
      type: "leaf",
      mdastType: "text",
      pmType: "text",
      toMdast: (node) => ({ type: "text", value: node.textContent }),
    },
  ],
};
