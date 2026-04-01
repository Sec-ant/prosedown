import type { Extension } from "../types";

export const docExt: Extension = {
  nodes: {
    doc: { content: "block+" },
  },
  handlers: [],
};
