import { Plugin } from "prosemirror-state";

/**
 * Plugin that converts pasting a URL over selected text into a link.
 *
 * When the user has text selected and pastes a valid URL, the selected text
 * is wrapped in a link mark with the pasted URL as `href` instead of
 * replacing the selection with the URL text.
 */
export function createPastePlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event, _slice) {
        const { state } = view;
        const { from, to, empty } = state.selection;
        if (empty) return false;

        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (!text) return false;

        try {
          new URL(text);
        } catch {
          return false;
        }

        const linkMark = state.schema.marks.link;
        if (!linkMark) return false;

        const tr = state.tr.addMark(from, to, linkMark.create({ url: text }));
        view.dispatch(tr);
        return true;
      },
    },
  });
}
