import type { Extension } from "../types";
import { mdastNode } from "../types";

export const paragraph: Extension = {
  nodes: {
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0] as const,
      parseDOM: [{ tag: "p" }],
    },
  },
  handlers: [
    {
      type: "node",
      mdastType: "paragraph",
      pmType: "paragraph",
      toMdast: (_node, children) => mdastNode({ type: "paragraph", children }),
    },
  ],
};
