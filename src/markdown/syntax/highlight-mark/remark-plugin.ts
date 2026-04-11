/**
 * Remark plugin for highlight mark (`==text==`).
 *
 * Wires the vanilla micromark tokenizer (micromark-extension-highlight-mark)
 * with the published mdast-util handlers (mdast-util-highlight-mark).
 */
import { highlightMarkFromMarkdown, highlightMarkToMarkdown } from "mdast-util-highlight-mark";
import { highlightMark } from "micromark-extension-highlight-mark";

/**
 * Remark plugin to add highlight mark support (`==text==` → `<mark>`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function remarkHighlightMark(this: any) {
  const data = this.data();

  if (!data.micromarkExtensions) data.micromarkExtensions = [];
  if (!data.fromMarkdownExtensions) data.fromMarkdownExtensions = [];
  if (!data.toMarkdownExtensions) data.toMarkdownExtensions = [];

  data.micromarkExtensions.push(highlightMark());
  data.fromMarkdownExtensions.push(highlightMarkFromMarkdown);
  data.toMarkdownExtensions.push(highlightMarkToMarkdown);
}
