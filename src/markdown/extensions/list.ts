import { wrappingInputRule, InputRule } from "prosemirror-inputrules";
import { splitListItem, liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import type { List, ListItem } from "mdast";
import type { Extension } from "../types";
import { mdastNode } from "../types";

export const listExt: Extension = {
  nodes: {
    list: {
      content: "list_item+",
      group: "block",
      attrs: {
        ordered: { default: false },
        start: { default: 1 },
        spread: { default: false },
      },
      toDOM: (node) => {
        if (node.attrs.ordered) {
          return (node.attrs.start as number) === 1
            ? (["ol", 0] as const)
            : (["ol", { start: node.attrs.start as number }, 0] as const);
        }
        return ["ul", 0] as const;
      },
      parseDOM: [
        { tag: "ul", getAttrs: () => ({ ordered: false }) },
        {
          tag: "ol",
          getAttrs: (dom: HTMLElement) => ({
            ordered: true,
            start: dom.hasAttribute("start") ? Number(dom.getAttribute("start")) : 1,
          }),
        },
      ],
    },
    list_item: {
      content: "block+",
      defining: true,
      attrs: {
        checked: { default: null },
        spread: { default: false },
      },
      toDOM: (node) => {
        const checked = node.attrs.checked as boolean | null;
        if (checked != null) {
          return [
            "li",
            { class: "task-list-item", "data-checked": String(checked) },
            [
              "span",
              {
                class: `task-checkbox${checked ? " is-checked" : ""}`,
                contenteditable: "false",
              },
            ],
            ["div", { class: "task-content" }, 0],
          ] as const;
        }
        return ["li", 0] as const;
      },
      parseDOM: [
        {
          tag: "li",
          getAttrs: (dom: HTMLElement) => {
            // Support project's own data-checked attribute
            if (dom.hasAttribute("data-checked")) {
              return { checked: dom.getAttribute("data-checked") === "true", spread: false };
            }
            // Support GFM-standard <input type="checkbox"> for paste from external sources
            const checkbox = dom.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            if (checkbox) {
              return { checked: checkbox.checked, spread: false };
            }
            return { checked: null, spread: false };
          },
        },
      ],
    },
  },
  handlers: [
    {
      type: "node",
      mdastType: "list",
      pmType: "list",
      attrs: (node) => {
        const l = node as List;
        return {
          ordered: l.ordered ?? false,
          start: l.start ?? 1,
          spread: l.spread ?? false,
        };
      },
      toMdast: (node, children) =>
        mdastNode({
          type: "list",
          ordered: node.attrs.ordered as boolean,
          start: (node.attrs.ordered as boolean) ? (node.attrs.start as number) : undefined,
          spread: node.attrs.spread as boolean,
          children,
        }),
    },
    {
      type: "node",
      mdastType: "listItem",
      pmType: "list_item",
      attrs: (node) => ({
        checked: (node as ListItem).checked ?? null,
        spread: (node as ListItem).spread ?? false,
      }),
      toMdast: (node, children) =>
        mdastNode({
          type: "listItem",
          spread: node.attrs.spread as boolean,
          checked: node.attrs.checked as boolean | null,
          children,
        }),
    },
  ],
  inputRules: (schema) => [
    wrappingInputRule(/^\s{0,3}[-*+]\s$/, schema.nodes.list),
    wrappingInputRule(
      /^\s{0,3}(\d+)\.\s$/,
      schema.nodes.list,
      (m) => ({ ordered: true, start: Number(m[1]!) }),
      (m, node) => node.childCount + (node.attrs.start as number) === Number(m[1]!),
    ),
    // Task list: [ ] or [x] at the start of a list_item paragraph
    new InputRule(/^\[([ x])\]\s$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      for (let d = $start.depth; d > 0; d--) {
        if ($start.node(d).type.name === "list_item") {
          const checked = match[1] === "x";
          const listItemPos = $start.before(d);
          const tr = state.tr
            .setNodeMarkup(listItemPos, undefined, {
              ...$start.node(d).attrs,
              checked,
            })
            .delete(start, end);
          return tr;
        }
      }
      return null;
    }),
  ],
  keymap: (schema) => ({
    Enter: splitListItem(schema.nodes.list_item),
    Tab: sinkListItem(schema.nodes.list_item),
    "Shift-Tab": liftListItem(schema.nodes.list_item),
    "Mod-Shift-8": wrapInList(schema.nodes.list),
    "Mod-Shift-9": wrapInList(schema.nodes.list, { ordered: true }),
  }),
};
