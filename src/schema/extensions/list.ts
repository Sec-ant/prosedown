import { wrappingInputRule, InputRule } from "prosemirror-inputrules";
import { splitListItem, liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import type { List, ListItem } from "mdast";
import type { Extension, MdastContent } from "../types";
import { mdastNode } from "../types";

export const list: Extension = {
  nodes: {
    bullet_list: {
      content: "list_item+",
      group: "block",
      attrs: { tight: { default: false } },
      toDOM: () => ["ul", 0] as const,
      parseDOM: [{ tag: "ul" }],
    },
    ordered_list: {
      content: "list_item+",
      group: "block",
      attrs: {
        order: { default: 1 },
        tight: { default: false },
      },
      toDOM: (node) =>
        (node.attrs.order as number) === 1
          ? (["ol", 0] as const)
          : (["ol", { start: node.attrs.order as number }, 0] as const),
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom: HTMLElement) => ({
            order: dom.hasAttribute("start") ? Number(dom.getAttribute("start")) : 1,
          }),
        },
      ],
    },
    list_item: {
      content: "block+",
      defining: true,
      attrs: { checked: { default: null } },
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
          getAttrs: (dom: HTMLElement) => ({
            checked: dom.hasAttribute("data-checked")
              ? dom.getAttribute("data-checked") === "true"
              : null,
          }),
        },
      ],
    },
  },
  handlers: [
    {
      type: "node",
      mdastType: "list",
      pmType: "bullet_list",
      resolvePmType: (node: MdastContent) =>
        (node as List).ordered ? "ordered_list" : "bullet_list",
      attrs: (node) => {
        const l = node as List;
        return {
          tight: l.spread === false,
          ...(l.ordered ? { order: l.start ?? 1 } : {}),
        };
      },
      toMdast: (node, children) =>
        mdastNode({
          type: "list",
          ordered: node.type.name === "ordered_list",
          start: node.type.name === "ordered_list" ? (node.attrs.order as number) : undefined,
          spread: !(node.attrs.tight as boolean),
          children,
        }),
    },
    {
      type: "node",
      mdastType: "list:ordered_toMdast",
      pmType: "ordered_list",
      toMdast: (node, children) =>
        mdastNode({
          type: "list",
          ordered: true,
          start: node.attrs.order as number,
          spread: !(node.attrs.tight as boolean),
          children,
        }),
    },
    {
      type: "node",
      mdastType: "listItem",
      pmType: "list_item",
      attrs: (node) => ({ checked: (node as ListItem).checked ?? null }),
      toMdast: (node, children) =>
        mdastNode({
          type: "listItem",
          spread: false,
          checked: node.attrs.checked as boolean | null,
          children,
        }),
    },
  ],
  inputRules: (schema) => [
    wrappingInputRule(/^\s{0,3}[-*+]\s$/, schema.nodes.bullet_list),
    wrappingInputRule(
      /^\s{0,3}(\d+)\.\s$/,
      schema.nodes.ordered_list,
      (m) => ({ order: Number(m[1]!) }),
      (m, node) => node.childCount + (node.attrs.order as number) === Number(m[1]!),
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
    "Mod-Shift-8": wrapInList(schema.nodes.bullet_list),
    "Mod-Shift-7": wrapInList(schema.nodes.ordered_list),
  }),
};
