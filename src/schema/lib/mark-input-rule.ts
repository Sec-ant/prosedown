import { InputRule } from "prosemirror-inputrules";
import type { MarkType } from "prosemirror-model";

/**
 * An input rule for inline marks (bold, italic, code, strikethrough).
 *
 * Regex convention:
 * - `match[1]` = the inner text content (e.g. "bold" from `**bold**`)
 * - `match[2]` = the trailing trigger character (the char typed after closing delimiter)
 *
 * When the regex matches, the delimiters are stripped and the mark is applied
 * to the inner text.
 */
export function markInputRule(re: RegExp, markType: MarkType): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const innerText = match[1];
    const trailingChar = match[2];
    if (!innerText) return null;

    // Check if the mark is allowed at this position
    const $start = state.doc.resolve(start);
    if (!$start.parent.type.allowsMarkType(markType) || !$start.parent.inlineContent) {
      return null;
    }

    // Collect existing marks at the start position
    const existingMarks = state.doc.nodeAt(start)?.marks ?? [];

    // Replace matched range with just the inner text
    const replacement = markType.schema.text(innerText);
    const tr = state.tr.replaceWith(start, end, replacement);

    // Apply all marks (existing + new) to the replacement
    const newStart = tr.mapping.map(start);
    const newEnd = newStart + replacement.nodeSize;

    for (const mark of existingMarks) {
      tr.addMark(newStart, newEnd, mark);
    }
    tr.addMark(newStart, newEnd, markType.create());

    // Remove stored marks so cursor doesn't continue with the mark
    tr.removeStoredMark(markType);

    // Append the trailing character (unless it's a newline)
    if (trailingChar && trailingChar !== "\n") {
      tr.insertText(trailingChar, newEnd, newEnd);
    }

    return tr;
  });
}
