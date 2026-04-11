# Schema Design — ProseDown

> This document persists the architectural decisions for the ProseMirror schema.
> It is the **single source of truth** for the schema design.
> Read this before making any schema-related changes.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   React UI                       │
│        ProseMirror + react-prosemirror           │
├─────────────────────────────────────────────────┤
│              ProseMirror Schema                  │
│         (from extension registry)                │
├──────────┬──────────────────────┬───────────────┤
│  Input   │    mdast → PM        │   PM → mdast  │
│  Rules   │   (fromMdast)        │  (toMdast)    │
│  Keymap  │                      │               │
├──────────┴──────────────────────┴───────────────┤
│            Extension Registry                    │
│   ext = { schema, fromMdast, toMdast,           │
│           inputRules, keymap }                   │
├─────────────────────────────────────────────────┤
│              unified / remark                    │
│  remark-parse  ←→  mdast  ←→  remark-stringify  │
│  remark-gfm, remark-cjk-friendly                │
└─────────────────────────────────────────────────┘
```

**Key decisions:**

- Use **unified/remark** ecosystem directly (remark-parse, remark-stringify, remark-gfm, remark-cjk-friendly).
- Do NOT use prosemirror-unified or prosemirror-remark — we write our own mdast ↔ PM bridge.
- Do NOT use prosemirror-markdown — it depends on markdown-it, we use micromark (via remark).
- Each markdown feature is an **Extension object** (plain object, NOT a class).
- The bridge uses a **handler map** (O(1) lookup) with a `type` tag for automatic dispatch.

## Extension Interface

```ts
interface Extension {
  nodes?: Record<string, NodeSpec>;
  marks?: Record<string, MarkSpec>;
  handlers: ConversionHandler[];
  inputRules?: (schema: Schema) => InputRule[];
  keymap?: (schema: Schema) => Record<string, Command>;
}
```

Four handler types, determined by a `type` discriminant:

| `type`          | mdast shape           | PM shape       | Framework behavior                                             |
| --------------- | --------------------- | -------------- | -------------------------------------------------------------- |
| `"node"`        | Parent (has children) | PM node        | Recursively converts children, creates PM node                 |
| `"mark"`        | Parent (has children) | PM mark        | Recursively converts children, auto-applies mark to each child |
| `"leaf"`        | Literal/void          | PM leaf node   | Extracts `value` as text content, no child recursion           |
| `"inline_node"` | Void                  | PM inline node | Creates inline node from attrs, no children                    |

## ProseMirror Schema

### Nodes

| Node              | Content                           | Group    | Attrs                 | Notes                                                                |
| ----------------- | --------------------------------- | -------- | --------------------- | -------------------------------------------------------------------- |
| `doc`             | `"block+"`                        | —        | —                     | Root                                                                 |
| `paragraph`       | `"inline*"`                       | `block`  | —                     | Default block                                                        |
| `heading`         | `"(text \| image)*"`              | `block`  | `level: 1-6`          | `defining: true`. No hard_break (CommonMark).                        |
| `code_block`      | `"text*"`                         | `block`  | `language, meta`      | `marks: ""`, `code: true`, `defining: true`, `createGapCursor: true` |
| `blockquote`      | `"block+"`                        | `block`  | —                     | `defining: true`, `createGapCursor: true`                            |
| `horizontal_rule` | — (leaf)                          | `block`  | —                     |                                                                      |
| `bullet_list`     | `"list_item+"`                    | `block`  | `tight`               |                                                                      |
| `ordered_list`    | `"list_item+"`                    | `block`  | `order, tight`        |                                                                      |
| `list_item`       | `"block+"`                        | —        | `checked: bool\|null` | `defining: true`. `null` = not a task item.                          |
| `table`           | `"table_row+"`                    | `block`  | —                     |                                                                      |
| `table_row`       | `"(table_cell \| table_header)+"` | —        | —                     |                                                                      |
| `table_header`    | `"inline*"`                       | —        | `align`               |                                                                      |
| `table_cell`      | `"inline*"`                       | —        | `align`               |                                                                      |
| `image`           | — (leaf)                          | `inline` | `src, alt, title`     | `inline: true`                                                       |
| `hard_break`      | — (leaf)                          | `inline` | —                     | `inline: true`                                                       |

### Marks

| Mark            | Attrs         | `excludes`  | Notes              |
| --------------- | ------------- | ----------- | ------------------ |
| `em`            | —             | `""`        |                    |
| `strong`        | —             | `""`        |                    |
| `code`          | —             | `"_"` (all) | `code: true`       |
| `link`          | `href, title` | `"link"`    | `inclusive: false` |
| `strikethrough` | —             | `""`        | GFM                |

### Content Groups

```
"block"  = paragraph | heading | code_block | blockquote
         | bullet_list | ordered_list | horizontal_rule | table
"inline" = text | image | hard_break
```

### Node Nesting

```
doc
├── paragraph → inline*  (marks: em, strong, code, link, strikethrough)
├── heading(1-6) → (text | image)*  (same marks)
├── code_block → text* (NO marks)
├── horizontal_rule (empty)
├── blockquote → block+ (recursive)
├── bullet_list(tight?) → list_item+
│   └── list_item(checked?) → block+
├── ordered_list(order, tight?) → list_item+
│   └── list_item(checked?) → block+
└── table → table_row+
    └── table_row → (table_cell | table_header)+
        └── table_cell/table_header(align) → inline*
```

### Mark Exclusion

```
em:            excludes ""      — coexists with everything
strong:        excludes ""
strikethrough: excludes ""
code:          excludes "_"     — exclusive (no formatting inside code spans)
link:          excludes "link"  — no nested links
```

## mdast ↔ PM Bridge

### Parse direction (mdast → PM)

1. `remark-parse` parses markdown string → mdast `Root`
2. `remark-gfm` + `remark-cjk-friendly` plugins run as part of unified pipeline
3. `resolveReferences()` pre-processes the mdast tree: collects `definition` nodes into a Map, then annotates `linkReference`/`imageReference` nodes with resolved URLs
4. `fromMdast()` walks the mdast tree, dispatching each node to its handler via `handlers.get(node.type)`:
   - `"node"` handler: recursively convert children → create PM node
   - `"mark"` handler: recursively convert children → auto-apply mark to each child
   - `"leaf"` handler: extract `value` → create PM leaf
   - `"inline_node"` handler: extract attrs → create PM inline node

### Serialize direction (PM → mdast)

1. `toMdast()` walks the PM document tree:
   - For each PM node, find handler by `node.type.name`
   - For text nodes with marks, iterate marks and wrap with mdast wrapper nodes
   - `mergeAdjacentWrappers()` post-processes to combine adjacent same-type wrappers
2. `remark-stringify` serializes the mdast tree → markdown string

### Reference link resolution (no mutation hack)

Unlike prosemirror-unified which mutates PM `Mark.attrs` after creation, we:

1. Pre-process the mdast tree BEFORE conversion
2. Collect all `definition` nodes into a `Map<id, {url, title}>`
3. When converting `linkReference`/`imageReference`, look up the definition immediately
4. The PM mark/node is created with the correct attrs from the start

## Input Rules

### Block triggers (start of line)

| Pattern                      | Result                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| `/^(#{1,6})\s$/`             | Heading 1-6                                                |
| `/^```([a-zA-Z]*)$/` + Enter | Fenced code block (Enter-triggered keymap, not input rule) |
| `/^\s{0,3}>\s$/`             | Block quote                                                |
| `/^[-*+]\s$/`                | Bullet list                                                |
| `/^\d+[.)]\s$/`              | Ordered list                                               |
| `/^([-*_])\1{2,}$/`          | Horizontal rule                                            |

### Inline triggers (while typing)

| Pattern             | Result        |
| ------------------- | ------------- |
| `**text** + char`   | Strong        |
| `*text* + char`     | Emphasis      |
| `` `text` + char `` | Code span     |
| `~~text~~ + char`   | Strikethrough |

### Keyboard shortcuts

| Key           | Action                                                      |
| ------------- | ----------------------------------------------------------- |
| `Mod-b`       | Toggle strong                                               |
| `Mod-i`       | Toggle emphasis                                             |
| `Mod-e`       | Toggle inline code                                          |
| `Mod-Shift-x` | Toggle strikethrough                                        |
| `Mod-k`       | Toggle link (prompt for URL)                                |
| `Shift-Enter` | Hard break                                                  |
| `Mod-Shift-7` | Ordered list                                                |
| `Mod-Shift-8` | Bullet list                                                 |
| `Tab`         | Code block: indent 2 spaces / Table: next cell / List: sink |
| `Shift-Tab`   | Code block: outdent / Table: prev cell / List: lift         |
| `Mod-Enter`   | Exit code block → paragraph below                           |
| `ArrowDown`   | Exit code block (at last line)                              |
| `Backspace`   | Exit empty code block / Exit empty blockquote               |
| `Enter`       | Exit empty blockquote paragraph                             |

## Interaction Design

This section documents the user-facing interaction model for each feature.
It defines _how_ the user creates, edits, and navigates content — not just what the schema supports.

### Design Principles

1. **Markdown-native**: Input rules should feel like writing markdown. Typing `**bold**` should produce bold text; typing `# ` should create a heading. The editor renders the result immediately rather than showing raw syntax.
2. **Progressive disclosure**: Basic actions (typing, keyboard shortcuts) always work. Advanced features (table manipulation, image upload) are surfaced via toolbar/context menus.
3. **Non-destructive exit**: Every block-level construct (code blocks, blockquotes, lists, tables) must have an obvious way to "escape" back to a normal paragraph. Getting trapped inside a code block or table is a common UX failure.
4. **Clipboard-aware**: Pasting markdown text should parse it. Pasting a URL on a text selection should wrap it in a link. Pasting an image should insert it.

### Links

**Current state**: Link mark exists with from-mdast/to-mdast conversion, but has NO input rules and NO keymaps. Users cannot create or edit links interactively.

**Interaction model**:

| Action                     | Trigger                           | Behavior                                                                                                        |
| -------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Create link from selection | `Mod-k`                           | Opens inline popup. URL field is auto-focused. Enter confirms, Escape cancels. Selected text becomes link text. |
| Create link from cursor    | `Mod-k` (no selection)            | Opens inline popup with both "Text" and "URL" fields.                                                           |
| Paste URL on selection     | Paste (`Mod-v`)                   | If clipboard is a URL and text is selected, wrap selection in link automatically. No popup.                     |
| Auto-linkify on paste      | Paste (`Mod-v`)                   | If clipboard is a bare URL and nothing is selected, insert as a link node.                                      |
| Edit existing link         | Click link or `Mod-k` inside link | Shows popup with current URL. User can edit or press "Unlink" to remove.                                        |
| Open link                  | `Mod-click` or popup button       | Opens URL in new tab.                                                                                           |

**Implementation plan**:

1. `Mod-k` command in `link.ts` extension keymap (Phase 1: toggle mark with prompt; Phase 2: floating popup component)
2. `handlePaste` plugin prop for URL-on-selection (Phase 1)
3. Link tooltip/popup component in React (Phase 2)

### Images

**Current state**: Image node exists with from-mdast/to-mdast conversion, but has NO input rules and NO keymaps. Images only come from parsed markdown.

**Interaction model**:

| Action                     | Trigger                      | Behavior                                                                         |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| Insert image via command   | Toolbar / slash command      | Opens dialog with URL, alt text, title fields.                                   |
| Paste image from clipboard | `Mod-v` (image in clipboard) | Image data is uploaded or embedded (base64 for local dev). Inserts `image` node. |
| Drag & drop image          | Drop file on editor          | Same as paste — upload and insert.                                               |
| Edit image properties      | Click on image               | Select image node. Popup shows src/alt/title for editing.                        |

**Implementation plan**:

1. Insert image command (Phase 1)
2. `handlePaste` + `handleDrop` plugin props (Phase 2)
3. Image NodeView with selection UI (Phase 2)

### Tables

**Current state**: Table nodes exist with from-mdast/to-mdast conversion, but have NO input rules and NO keymaps. Tables only come from parsed markdown. Header row bug: from-mdast maps all cells to `table_cell` instead of using `table_header` for the first row.

**Interaction model**:

| Action              | Trigger                                  | Behavior                                                                         |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| Insert table        | Toolbar / slash command                  | Insert a 3×2 table (1 header row + 1 data row). Cursor in first header cell.     |
| Navigate cells      | `Tab` / `Shift-Tab`                      | Tab: next cell (left→right, then next row). Shift-Tab: previous cell.            |
| New row at end      | `Tab` in last cell                       | Creates a new data row and moves to its first cell.                              |
| Enter in cell       | `Enter`                                  | Inserts hard break (`<br>`) within the cell. Table cells contain `inline*` only. |
| Add row             | Context menu / shortcut                  | Inserts row above or below current row.                                          |
| Add column          | Context menu / shortcut                  | Inserts column left or right of current.                                         |
| Delete row / column | Context menu                             | Removes current row or column.                                                   |
| Delete table        | Context menu or Backspace on empty table | Removes entire table, replaces with paragraph.                                   |
| Cell alignment      | Context menu                             | Set left / center / right alignment per column.                                  |

**Implementation plan**:

1. Fix header row bug in from-mdast (Phase 1)
2. Insert table command + `Tab`/`Shift-Tab` cell navigation (Phase 1)
3. Context menu with row/column operations (Phase 2)
4. Consider `prosemirror-tables` for advanced features like cell selection and merging (Phase 3)

### Code Blocks

**Current state**: Code block creation is Enter-triggered (type ` ```lang ` then press Enter). Tab/Shift-Tab indent, Mod-Enter/ArrowDown/Backspace exit keymaps all working. NO syntax highlighting yet.

**Interaction model**:

| Action              | Trigger                                  | Behavior                                                                                                                                         |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create code block   | Type ` ```lang ` + `Enter`               | Enter keymap checks line for `/^```([a-zA-Z]*)$/`, replaces paragraph with code block. Language stored in attrs.                                 |
| Syntax highlighting | Automatic                                | Decorations applied via `prosemirror-highlight` + Shiki. Updates on content/language change with debounce. Theme follows editor dark/light mode. |
| Change language     | Click language label                     | Editable dropdown/autocomplete above the code block (NodeView).                                                                                  |
| Indent              | `Tab`                                    | Inserts 2 spaces at cursor (does NOT move focus).                                                                                                |
| Outdent             | `Shift-Tab`                              | Removes up to 2 leading spaces from current line.                                                                                                |
| Exit code block     | `Mod-Enter`                              | Creates a new paragraph below the code block and moves cursor there.                                                                             |
| Exit code block     | `ArrowDown` at last line                 | If cursor is at end of last line, move to the block below (or create paragraph).                                                                 |
| Delete code block   | `Backspace` at start of empty code block | Converts to empty paragraph.                                                                                                                     |

**Implementation plan**:

1. Tab/Shift-Tab indent commands in `code-block.ts` keymap (Phase 1)
2. `Mod-Enter` and `ArrowDown` exit commands (Phase 1)
3. Syntax highlighting via `prosemirror-highlight` + Shiki (Phase 1)
4. Language selector NodeView (Phase 2)

**Syntax highlighting tech choice**: `prosemirror-highlight` with Shiki.

- Shiki provides high-quality TextMate-grammar-based highlighting with hundreds of languages.
- `prosemirror-highlight` applies highlighting as ProseMirror decorations (does not alter document structure).
- Languages are loaded lazily (only when a code block uses them).
- The Shiki theme should be set to match the editor's color scheme.

### Task Lists

**Current state**: `list_item` has a `checked` attr (`null | boolean`), and from-mdast correctly parses `- [ ]` / `- [x]` task items. But there is NO input rule for creating task items interactively and NO checkbox click interaction.

**Interaction model**:

| Action                        | Trigger                              | Behavior                                                                                 |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Create task item              | Type `[ ] ` at start of a list item  | Sets `checked: false` on the current list item. Checkbox appears.                        |
| Create checked task item      | Type `[x] ` at start of a list item  | Sets `checked: true`.                                                                    |
| Create task list from scratch | Type `- [ ] text`                    | The `- ` triggers bullet list creation, then `[ ] ` inside the list item sets `checked`. |
| Toggle checkbox               | Click the checkbox                   | Toggles `checked` between `true` and `false`.                                            |
| Remove task status            | Delete the checkbox text / UI action | Sets `checked: null`, converting back to a regular list item.                            |

**Implementation plan**:

1. Input rule in `list.ts` for `[ ] ` / `[x] ` within list items (Phase 1)
2. `list_item` NodeView that renders a clickable checkbox when `checked != null` (Phase 1)
3. CSS styling for checked items (line-through, dimmed text) (Phase 1)

### Gap Cursor

The `prosemirror-gapcursor` plugin allows placing the cursor in "gaps" between block nodes that cannot normally receive a text cursor — enabling users to insert content between adjacent closed blocks (e.g., two code blocks, a blockquote followed by a table).

**How it works**: `GapCursor.valid($pos)` checks `closedBefore($pos)` and `closedAfter($pos)`. These helpers drill into adjacent nodes via `lastChild`/`firstChild`. If they reach a node with `inlineContent` (like a paragraph), the side is "open" and no gap cursor is needed. The helper `needsGap(type)` returns `true` for atoms, isolating nodes, or nodes whose spec includes `createGapCursor: true`.

**Custom spec property**: `code_block` and `blockquote` NodeSpecs include `createGapCursor: true`. This is a custom property (not part of ProseMirror core API) that only the gap cursor plugin reads via `needsGap()`. It has zero side effects on other ProseMirror behavior — it simply tells the gap cursor system to treat these nodes as "closed" boundaries.

**Valid gap cursor positions** (both sides must be closed):

- Between `code_block` ↔ `code_block`, `blockquote` ↔ `blockquote`, `code_block` ↔ `blockquote`
- Between any of `{code_block, blockquote}` ↔ `{horizontal_rule, table}` (atoms/isolating)
- At start of doc before `code_block` / `blockquote` / `horizontal_rule` / `table`
- At end of doc after `code_block` / `blockquote` / `horizontal_rule` / `table`

**NOT valid** (one side is open):

- Between `paragraph` ↔ anything, `heading` ↔ anything — these have inline content, so a regular text cursor can reach the boundary.

**Plugin ordering**: `gapCursor()` must come **before** `createKeymaps()` in the plugin array. Otherwise, code_block's `arrowDownExit` keymap fires first on ArrowDown and jumps via `Selection.findFrom()` (which doesn't know about gap cursors), bypassing the gap cursor position.

**Pressing Enter on a gap cursor**: The `createParagraphNear` command from `prosemirror-commands` (included in `baseKeymap`) handles this — it detects the parent lacks inline content, finds the default block type (paragraph), and inserts it at the gap position.

### Block Exit Behaviors

Users must never get "trapped" inside a block construct. These exit behaviors apply globally:

| Context                            | Action      | Result                                                                |
| ---------------------------------- | ----------- | --------------------------------------------------------------------- |
| Code block (empty)                 | `Backspace` | Convert to empty paragraph                                            |
| Code block                         | `Mod-Enter` | Create paragraph below, move cursor                                   |
| Code block (end of last line)      | `ArrowDown` | Move to block below (or create paragraph)                             |
| Blockquote (empty first paragraph) | `Backspace` | Lift paragraph out of blockquote                                      |
| Blockquote (empty paragraph)       | `Enter`     | Exit blockquote, create paragraph below                               |
| List item (empty)                  | `Enter`     | If nested: lift one level. If top-level: exit list, create paragraph. |
| List item                          | `Shift-Tab` | Lift (unindent) one nesting level                                     |
| Table (last cell, Tab)             | `Tab`       | Create new row                                                        |
| Table                              | `Mod-Enter` | Exit table, create paragraph below                                    |

### Phase Summary

**Phase 1 — Core interactions (MVP)**:

- [x] `Mod-k` link creation (command + prompt, no floating UI yet)
- [x] Paste URL on selection → auto-link (`createPastePlugin()`)
- [x] Code block: Tab/Shift-Tab indent, Mod-Enter exit, ArrowDown exit, Backspace on empty
- [ ] Code block: syntax highlighting (prosemirror-highlight + Shiki)
- [x] Table: fix header row from-mdast bug (annotateTableCells + resolvePmType)
- [x] Table: Tab/Shift-Tab cell navigation (Tab creates new row at end)
- [x] Table: insert table command (`insertTable()`)
- [x] Task list: `[ ] ` / `[x] ` input rule
- [ ] Task list: checkbox click toggle (NodeView or handleClick)
- [x] Block exit behaviors for code blocks, blockquotes
- [x] Gap cursor between closed blocks (`createGapCursor: true` on code_block, blockquote)

**Phase 2 — Rich interactions**:

- [ ] Link floating popup (React component)
- [ ] Image paste from clipboard, drag & drop
- [ ] Image insertion command
- [ ] Code block language selector (NodeView)
- [ ] Table context menu (add/delete row/column, alignment)
- [ ] Slash command system (`/` trigger)

**Phase 3 — Advanced**:

- [ ] `prosemirror-tables` integration for cell selection/merging
- [ ] Image resize handles
- [ ] Collaborative editing support
- [ ] Auto-linkify while typing

## CJK Support

`remark-cjk-friendly` and `remark-cjk-friendly-gfm-strikethrough` are micromark-level plugins that fix emphasis/strikethrough delimiter flanking rules for CJK text. They are transparent — the mdast output is identical, only parsing rules change.

## File Structure

```
src/markdown/
├── index.ts                    ← public API: schema, parseMarkdown, serializeMarkdown
├── processor.ts                ← unified pipeline config
├── types.ts                    ← Extension, handler type definitions
├── extensions/
│   ├── doc.ts
│   ├── paragraph.ts
│   ├── text.ts
│   ├── heading.ts
│   ├── blockquote.ts
│   ├── code.ts
│   ├── thematic-break.ts
│   ├── list.ts                 ← lists and task list checked attr
│   ├── table.ts                ← table + table_row + table_header + table_cell
│   ├── strong.ts
│   ├── emphasis.ts
│   ├── inline-code.ts
│   ├── delete.ts
│   ├── highlight.ts
│   ├── link.ts                 ← includes linkReference handler
│   ├── image.ts                ← includes imageReference handler
│   └── break.ts
├── convert/
│   ├── from-mdast.ts           ← mdast → PM conversion engine
│   ├── to-mdast.ts             ← PM → mdast conversion engine
│   ├── resolve-refs.ts         ← reference link pre-processing
│   └── merge-wrappers.ts       ← merge adjacent mdast wrapper nodes
├── input/
│   └── mark-input-rule.ts      ← MarkInputRule for inline mark triggers
└── syntax/
    └── highlight-mark/         ← custom remark/micromark highlight support
```
