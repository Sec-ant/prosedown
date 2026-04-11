import { baseKeymap } from "prosemirror-commands";
import { gapCursor } from "prosemirror-gapcursor";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Plugin } from "prosemirror-state";
import { createInputRules, createKeymaps } from "../../markdown";
import { createClipboardPlugin } from "./clipboard";
import { createImageCenterPlugin } from "./image-center";
import { createPastePlugin } from "./paste-link";
import { createTableAlignPlugin } from "./table-align";
import { createTaskPlugin } from "./task-list";

/** Core editor plugins in the correct order. Consumers can prepend or append extra plugins via spreading. */
export function createDefaultPlugins(): Plugin[] {
  return [
    createInputRules(),
    gapCursor(),
    ...createKeymaps(),
    createClipboardPlugin(),
    createPastePlugin(),
    createTaskPlugin(),
    createTableAlignPlugin(),
    createImageCenterPlugin(),
    history(),
    keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
    keymap(baseKeymap),
  ];
}
