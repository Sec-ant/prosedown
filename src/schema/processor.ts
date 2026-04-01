import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import remarkHighlightMark from "./lib/highlight-mark/remark-plugin";
import remarkCjkFriendlyHighlightMark from "./lib/highlight-mark/cjk-friendly-remark-plugin";

/**
 * Unified processor configured with all plugins for parsing and serializing.
 *
 * Parse direction:  markdown string → mdast Root
 * Serialize direction: mdast Root → markdown string
 *
 * Plugins:
 * - remark-gfm: tables, strikethrough, task lists, autolinks
 * - remark-highlight-mark: highlight mark (`==text==`)
 * - remark-cjk-friendly: CJK-aware emphasis delimiter flanking
 * - remark-cjk-friendly-gfm-strikethrough: CJK-aware strikethrough flanking
 * - remark-cjk-friendly-highlight-mark: CJK-aware highlight mark flanking
 */
export const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkHighlightMark)
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyGfmStrikethrough)
  .use(remarkCjkFriendlyHighlightMark)
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    strong: "*",
    rule: "-",
    listItemIndent: "one",
    fences: true,
  });
