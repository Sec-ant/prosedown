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
  parseMarkdown,
} from "./schema";
import { highlightPlugin, codeThemeSyncPlugin } from "./plugins/highlight";

/** Stable reference — must NOT be defined inside a component. */
const nodeViewComponents = {
  code_block: CodeBlockView,
};

const sampleMarkdown = `# Welcome to ProseDown

A **Markdown** editor built with *ProseMirror*, supporting CommonMark and GFM.

## Features

- **Bold**, *italic*, \`code\`, and ~~strikethrough~~
- [Links](https://example.com) and images
- Headings (all 6 levels)
- Blockquotes, code blocks, and horizontal rules

> Blockquotes work too — including **nested** formatting.

\`\`\`js
const hello = "world";
\`\`\`

---

### Lists

1. Ordered lists
2. With numbering

- Bullet lists
- Work as well

#### Tasks

- [ ] Unchecked task
- [x] Completed task
- [ ] Another task

| Feature | Status |
|---|---|
| Bold | Done |
| Tables | Done |
| Task lists | Done |

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
