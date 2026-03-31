import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";

/**
 * Unified processor configured with all plugins for parsing and serializing.
 *
 * Parse direction:  markdown string → mdast Root
 * Serialize direction: mdast Root → markdown string
 *
 * Plugins:
 * - remark-gfm: tables, strikethrough, task lists, autolinks
 * - remark-cjk-friendly: CJK-aware emphasis delimiter flanking
 * - remark-cjk-friendly-gfm-strikethrough: CJK-aware strikethrough flanking
 */
export const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkCjkFriendlyGfmStrikethrough)
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    strong: "*",
    rule: "-",
    listItemIndent: "one",
    fences: true,
  });
