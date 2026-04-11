import { Plugin } from "prosemirror-state";

/**
 * Plugin that handles clicking on task list checkboxes.
 *
 * Clicking the `.task-checkbox` element toggles the `checked` attribute
 * on the enclosing `list_item` node.
 */
export function createTaskPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return false;
          if (!target.classList.contains("task-checkbox")) return false;

          event.preventDefault();

          const li = target.closest("li.task-list-item");
          if (!li) return false;

          const pos = view.posAtDOM(li, 0);
          const $pos = view.state.doc.resolve(pos);
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === "list_item" && node.attrs.checked != null) {
              view.dispatch(
                view.state.tr.setNodeMarkup($pos.before(d), undefined, {
                  ...node.attrs,
                  checked: !(node.attrs.checked as boolean),
                }),
              );
              return true;
            }
          }
          return false;
        },
      },
    },
  });
}
