/**
 * CJK-friendly remark plugin for highlight mark (`==text==`).
 *
 * Replaces the vanilla flanking rules from micromark-extension-highlight-mark
 * with CJK-aware character classification from micromark-extension-cjk-friendly-util.
 *
 * Use alongside `remarkHighlightMark` — this overrides the base tokenizer,
 * mirroring the pattern of `remark-cjk-friendly-gfm-strikethrough`.
 *
 * Based on micromark-extension-highlight-mark by shlroland and the CJK-friendly
 * flanking rules from micromark-extension-cjk-friendly-gfm-strikethrough by tats-u.
 */
import {
  TwoPreviousCode,
  classifyCharacter,
  classifyPrecedingCharacter,
  isCjk,
  isCodeHighSurrogate,
  isCodeLowSurrogate,
  isIvs,
  isNonCjkPunctuation,
  isUnicodeWhitespace,
  tryGetGenuineNextCode,
  tryGetGenuinePreviousCode,
} from "micromark-extension-cjk-friendly-util";
import { splice } from "micromark-util-chunked";
import { resolveAll } from "micromark-util-resolve-all";
import { codes, constants, types } from "micromark-util-symbol";
import type {
  Code,
  Effects,
  Event,
  Extension,
  State,
  Token,
  TokenizeContext,
} from "micromark-util-types";

/**
 * Make highlight mark (`==text==`) friendly with CJK punctuation in flanking rules.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function remarkCjkFriendlyHighlightMark(this: any) {
  const data = this.data();
  if (!data.micromarkExtensions) data.micromarkExtensions = [];
  data.micromarkExtensions.push(highlightMarkCjkFriendly());
}

/**
 * Create a CJK-friendly micromark extension for highlight mark syntax (`==text==`).
 */
function highlightMarkCjkFriendly(): Extension {
  const tokenizer = {
    name: "highlight",
    tokenize: tokenizeHighlight,
    resolveAll: resolveAllHighlight,
  };

  return {
    text: { [codes.equalsTo]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [codes.equalsTo] },
  };

  /**
   * Resolve all highlight sequences — match openers and closers.
   */
  function resolveAllHighlight(events: Event[], context: TokenizeContext): Event[] {
    let index = -1;

    while (++index < events.length) {
      if (
        events[index]![0] === "enter" &&
        events[index]![1].type === "highlightSequenceTemporary" &&
        events[index]![1]._close
      ) {
        let open = index;

        while (open--) {
          if (
            events[open]![0] === "exit" &&
            events[open]![1].type === "highlightSequenceTemporary" &&
            events[open]![1]._open &&
            events[index]![1].end.offset - events[index]![1].start.offset ===
              events[open]![1].end.offset - events[open]![1].start.offset
          ) {
            events[index]![1].type = "highlightSequence";
            events[open]![1].type = "highlightSequence";

            const highlight: Token = {
              type: "highlight",
              start: Object.assign({}, events[open]![1].start),
              end: Object.assign({}, events[index]![1].end),
            };

            const text: Token = {
              type: "highlightText",
              start: Object.assign({}, events[open]![1].end),
              end: Object.assign({}, events[index]![1].start),
            };

            const nextEvents: Event[] = [
              ["enter", highlight, context],
              ["enter", events[open]![1], context],
              ["exit", events[open]![1], context],
              ["enter", text, context],
            ];

            const insideSpan = context.parser.constructs.insideSpan.null;
            if (insideSpan) {
              splice(
                nextEvents,
                nextEvents.length,
                0,
                resolveAll(insideSpan, events.slice(open + 1, index), context),
              );
            }

            splice(nextEvents, nextEvents.length, 0, [
              ["exit", text, context],
              ["enter", events[index]![1], context],
              ["exit", events[index]![1], context],
              ["exit", highlight, context],
            ]);

            splice(events, open - 1, index - open + 3, nextEvents);
            index = open + nextEvents.length - 2;
            break;
          }
        }
      }
    }

    // Convert remaining temporary sequences to plain data.
    index = -1;
    while (++index < events.length) {
      if (events[index]![1].type === "highlightSequenceTemporary") {
        events[index]![1].type = types.data;
      }
    }

    return events;
  }

  /**
   * Tokenize `==` sequences with CJK-friendly flanking classification.
   */
  function tokenizeHighlight(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    const { now, sliceSerialize, previous: tentativePrevious } = this; // eslint-disable-line typescript-eslint/unbound-method
    const previous: Code = isCodeLowSurrogate(tentativePrevious)
      ? tryGetGenuinePreviousCode(tentativePrevious, now(), sliceSerialize)
      : tentativePrevious;
    const before = classifyCharacter(previous);
    // TwoPreviousCode constructor expects non-null, but previous can be null at
    // start of document. At that point classifyCharacter already returns
    // whitespace, so the cast is functionally safe — matches the reference JS.
    const twoPrevious = new TwoPreviousCode(previous as Exclude<Code, null>, now(), sliceSerialize);
    const beforePrimary = classifyPrecedingCharacter(
      before,
      twoPrevious.value.bind(twoPrevious),
      previous,
    );
    const events = this.events;
    let size = 0;

    return start;

    function start(code: Code): State | undefined {
      if (
        previous === codes.equalsTo &&
        events[events.length - 1]![1].type !== types.characterEscape
      ) {
        return nok(code);
      }

      effects.enter("highlightSequenceTemporary");
      return more(code);
    }

    function more(code: Code): State | undefined {
      if (code === codes.equalsTo) {
        // Only allow exactly 2 equals signs.
        if (size > 1) return nok(code);
        effects.consume(code);
        size++;
        return more;
      }

      // Must have exactly 2.
      if (size < 2) return nok(code);

      const token = effects.exit("highlightSequenceTemporary");
      const after = classifyCharacter(
        isCodeHighSurrogate(code) ? tryGetGenuineNextCode(code, now(), sliceSerialize) : code,
      );

      // CJK-friendly flanking rules
      const beforeSpaceOrNonCjkPunctuation =
        isNonCjkPunctuation(beforePrimary) || isUnicodeWhitespace(beforePrimary);
      const afterSpaceOrNonCjkPunctuation =
        isNonCjkPunctuation(after) || isUnicodeWhitespace(after);
      const beforeCjkOrIvs = isCjk(beforePrimary) || isIvs(before);

      token._open =
        !afterSpaceOrNonCjkPunctuation ||
        (after === constants.attentionSideAfter &&
          (beforeSpaceOrNonCjkPunctuation || beforeCjkOrIvs));
      token._close =
        !beforeSpaceOrNonCjkPunctuation ||
        (before === constants.attentionSideAfter &&
          (afterSpaceOrNonCjkPunctuation || isCjk(after)));

      return ok(code);
    }
  }
}
