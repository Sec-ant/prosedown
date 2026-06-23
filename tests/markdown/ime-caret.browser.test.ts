import { describe, it, expect, afterEach, beforeEach } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser/context";
import { TextSelection } from "prosemirror-state";
import { createReactEditor, flushBrowserUpdates, type MountedReactEditor } from "./browser-helpers";

/**
 * Regression: committing an IME composition in the middle of a line must leave
 * the *DOM* caret next to the inserted text, not collapsed to the start of the
 * block. ProseMirror's selection is always correct here — the bug was that the
 * visible browser caret jumped to line start because react-prosemirror skips
 * selectionToDOM when the PM selection is unchanged across the commit render.
 *
 * These tests use the real Chrome DevTools Protocol IME events, so they only
 * run under the Playwright chromium provider.
 */
describe("ReactEditorView IME caret position", () => {
  let mounted: MountedReactEditor | null = null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(() => {
    mounted?.destroy();
    mounted = null;
  });

  function domCaret(): { node: Node | null; offset: number } {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { node: null, offset: -1 };
    return { node: sel.anchorNode, offset: sel.anchorOffset };
  }

  async function imeCommit(
    session: ReturnType<typeof cdp>,
    pinyin: string,
    commit: string,
  ): Promise<void> {
    for (let i = 1; i <= pinyin.length; i++) {
      await session.send("Input.imeSetComposition", {
        text: pinyin.slice(0, i),
        selectionStart: i,
        selectionEnd: i,
      });
      await flushBrowserUpdates();
    }
    await session.send("Input.insertText", { text: commit });
    await flushBrowserUpdates();
    await flushBrowserUpdates();
  }

  it("keeps the DOM caret beside text after a mid-line IME commit", async () => {
    const session = cdp();
    mounted = await createReactEditor("the quick brown fox\n");
    const view = mounted.getView();
    view.focus();
    // Cursor between "the quick " and "brown" (PM pos 11).
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 11)));
    await flushBrowserUpdates();

    await imeCommit(session, "ce", "测");

    expect(view.state.selection.from).toBe(12);
    const caret = domCaret();
    // The caret must sit inside the text node right after the inserted glyph,
    // NOT collapsed onto the paragraph element at offset 0.
    expect(caret.node?.nodeType).toBe(Node.TEXT_NODE);
    expect(caret.node?.textContent).toContain("测");
    expect(caret.offset).toBe(11);
  });

  it("keeps the DOM caret stable across consecutive mid-line IME commits", async () => {
    const session = cdp();
    mounted = await createReactEditor("the quick brown fox\n");
    const view = mounted.getView();
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 11)));
    await flushBrowserUpdates();

    await imeCommit(session, "ce", "测");
    await imeCommit(session, "shi", "试");

    expect(view.state.doc.textContent).toBe("the quick 测试brown fox");
    expect(view.state.selection.from).toBe(13);
    const caret = domCaret();
    expect(caret.node?.nodeType).toBe(Node.TEXT_NODE);
    expect(caret.node?.textContent).toContain("测试");
    expect(caret.offset).toBe(12);
  });
});
