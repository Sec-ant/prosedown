import { useCallback, useState } from "react";
import { EditorState, type Transaction } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { gapCursor } from "prosemirror-gapcursor";
import {
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEffect,
} from "@handlewithcare/react-prosemirror";
import { cn } from "./lib/cn";
import { ThemeToggle } from "./ThemeToggle";
import { CodeBlockView } from "./CodeBlockView";
import {
  createClipboardPlugin,
  createInputRules,
  createKeymaps,
  createPastePlugin,
  createTaskPlugin,
  createTableAlignPlugin,
  parseMarkdown,
} from "./schema";
import { highlightPlugin, codeThemeSyncPlugin } from "./plugins/highlight";

/** Stable reference — must NOT be defined inside a component. */
const nodeViewComponents = {
  code: CodeBlockView,
};

const sampleMarkdown = `# Welcome to ProseDown

A **Markdown** editor built with *ProseMirror*, supporting CommonMark and GFM.

## Inline Formatting

**Bold**, *italic*, \`inline code\`, ~~strikethrough~~, and ==highlight==.

Combine them: ***bold italic***, **==bold highlight==**, ~~==strike highlight==~~.

[Links](https://example.com "Example Site") can have titles. Images too:

![Placeholder](https://placehold.co/400x80/1a1a2e/e0e0e0?text=ProseDown "A placeholder image")

## CJK Inline Formatting

日本語で**太字**や*斜体*、==ハイライト==、~~取り消し線~~が使えます。

CJK punctuation inside delimiters: *重要！*次の文、**「引用」**の例。

## Headings

### Third Level

#### Fourth Level

##### Fifth Level

###### Sixth Level

## Blockquotes

> Simple blockquote with **bold** and *italic* text.
>
> > Nested blockquote — going deeper.

## Code Blocks

\`\`\`typescript
interface Schema<N extends string, M extends string> {
  nodes: Record<N, NodeSpec>;
  marks: Record<M, MarkSpec>;
}

function createEditor(schema: Schema<string, string>) {
  return new EditorView(document.body, {
    state: EditorState.create({ schema }),
  });
}
\`\`\`

\`\`\`python
# A code block with a different language
def fibonacci(n: int) -> list[int]:
    a, b = 0, 1
    return [(a, (a, b) := (b, a + b))[0] for _ in range(n)]
\`\`\`

\`\`\`
A fenced code block with no language specified.
\`\`\`

---

## Lists

1. First ordered item
2. Second ordered item
3. Third — numbering is automatic

- Bullet list
- With multiple items
  - Nested bullets work too

10. Start numbering from 10
11. Continues from there

### Task Lists

- [x] Completed task
- [ ] Unchecked task
- [x] ~~Done and struck through~~
- [ ] **Important** remaining task

## Tables

| Feature | Syntax | Status |
|:---|:---:|---:|
| Bold | \`**text**\` | Done |
| Italic | \`*text*\` | Done |
| Highlight | \`==text==\` | Done |
| Strikethrough | \`~~text~~\` | Done |
| Tables | GFM pipes | Done |

## Thematic Breaks

Content above the break.

---

Content below the break.

## Edge Cases

A paragraph with a hard\\
line break in the middle.

Inline code with backticks: \`\`\`code\`\`\` spans and \`a \`nested\` pair\`.

Empty link: [](https://example.com) and image with no alt: ![](https://placehold.co/20x20/888/888).

Happy writing!
`;

function createDefaultState() {
  const doc = parseMarkdown(sampleMarkdown);
  return EditorState.create({
    doc,
    plugins: [
      reactKeys(),
      createInputRules(),
      gapCursor(),
      ...createKeymaps(),
      createClipboardPlugin(),
      createPastePlugin(),
      createTaskPlugin(),
      createTableAlignPlugin(),
      highlightPlugin,
      codeThemeSyncPlugin,
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap(baseKeymap),
    ],
  });
}

/** Debug component that exposes the EditorView on window for debugging (dev only) */
function DebugViewExposer() {
  useEditorEffect((view) => {
    if (import.meta.env.DEV) {
      (window as Window & { __pmView?: typeof view }).__pmView = view;
    }
  });
  return null;
}

export function App() {
  const [editorState, setEditorState] = useState(createDefaultState);

  const dispatchTransaction = useCallback((tr: Transaction) => {
    setEditorState((s) => s.apply(tr));
  }, []);

  const isEmpty = editorState.doc.textContent.length === 0;

  return (
    <main className={cn("flex min-h-svh flex-col", "px-5 py-8 sm:px-8 sm:py-14")}>
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between">
        <h1
          className={cn("font-display tracking-tight text-base-content/80", "text-4xl sm:text-5xl")}
        >
          ProseDown
        </h1>
        <ThemeToggle />
      </header>

      <div className={cn("relative mx-auto w-full max-w-2xl flex-1", "mt-8 sm:mt-12")}>
        <ProseMirror
          state={editorState}
          dispatchTransaction={dispatchTransaction}
          nodeViewComponents={nodeViewComponents}
        >
          <DebugViewExposer />
          <ProseMirrorDoc
            className={cn(
              "min-h-72 font-serif text-lg leading-[1.75] text-base-content caret-primary",
              isEmpty && "is-empty",
            )}
            role="textbox"
            aria-label="Editor"
            aria-multiline="true"
          />
        </ProseMirror>
      </div>
    </main>
  );
}
