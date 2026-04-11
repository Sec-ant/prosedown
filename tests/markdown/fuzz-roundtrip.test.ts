/**
 * Fuzz tests for the markdown roundtrip pipeline.
 *
 * Generates random markdown documents and verifies:
 * 1. Parsing doesn't throw
 * 2. Serializing doesn't throw
 * 3. Re-parsing the serialized output produces a structurally identical document
 * 4. The PM document is valid according to the schema
 *
 * Uses a seeded PRNG for reproducibility — failing seeds can be pinned in the
 * `FAILING_SEEDS` array to create regression tests.
 */

import { describe, it, expect } from "vite-plus/test";
import { EditorState } from "prosemirror-state";
import { parseMarkdown, serializeMarkdown, schema } from "../../src/markdown";
import { Rng, generateRandomMarkdown, randomWord, validatePMNode } from "./fuzz-helpers";

// ========== Tests ==========

/** Seeds that previously found bugs — keep as regression tests. */
const FAILING_SEEDS: number[] = [];

const FUZZ_ITERATIONS = 200;

describe("Fuzz: roundtrip", () => {
  it("random documents survive parse → serialize → re-parse", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const seed = i;
      const rng = new Rng(seed);
      const md = generateRandomMarkdown(rng);

      let doc1: ReturnType<typeof parseMarkdown>;
      try {
        doc1 = parseMarkdown(md);
      } catch (e: unknown) {
        throw new Error(`[seed=${seed}] Parse failed:\n${md}\n\n${String(e)}`);
      }

      let serialized: string;
      try {
        serialized = serializeMarkdown(doc1);
      } catch (e: unknown) {
        throw new Error(`[seed=${seed}] Serialize failed:\n${md}\n\n${String(e)}`);
      }

      let doc2: ReturnType<typeof parseMarkdown>;
      try {
        doc2 = parseMarkdown(serialized);
      } catch (e: unknown) {
        throw new Error(
          `[seed=${seed}] Re-parse failed:\nOriginal:\n${md}\n\nSerialized:\n${serialized}\n\n${String(e)}`,
        );
      }

      // The PM documents should be structurally identical
      expect(doc2.toJSON(), `[seed=${seed}] Roundtrip mismatch`).toEqual(doc1.toJSON());
    }
  });

  it("schema-validates all generated documents", () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const seed = i + 10000;
      const rng = new Rng(seed);
      const md = generateRandomMarkdown(rng);

      const doc = parseMarkdown(md);
      const errors = validatePMNode(doc);
      expect(errors, `[seed=${seed}] Schema validation errors`).toEqual([]);
    }
  });

  it("handles edge-case markdown inputs without crashing", () => {
    const edgeCases = [
      "", // empty
      "\n", // just newline
      "\n\n\n", // multiple newlines
      "# ", // heading without text
      "> ", // empty blockquote
      "- ", // empty list item
      "```\n```", // empty code block
      "---", // hr
      "| |\n|---|\n| |", // minimal table
      "****", // empty bold
      "**", // unclosed bold
      "*", // lone asterisk
      "`", // lone backtick
      "```", // unclosed code fence
      "[]()", // empty link
      "![]()", // empty image
      "- [ ] ", // empty task item
      "\\", // lone backslash
      "# **bold heading**", // marks in heading
      "> > > deeply nested", // deep blockquote
      "- - - nested list markers", // this is a thematic break, not nested lists
      "1. 2. 3.", // non-standard ordered list
      "| a |\n|---|\n| b |\n| c |\n| d |", // long single-column table
      "```js\nconst x = `template`;\n```", // backticks inside code
      "text with\\\nhard break", // hard break
      "[link **with bold**](url)", // mark inside link
      "**bold *and italic***", // nested marks
      Array(50).fill("word").join(" "), // very long paragraph
      Array(20).fill("- item").join("\n"), // many list items
      Array(10).fill("# heading").join("\n\n"), // many headings
    ];

    for (const md of edgeCases) {
      expect(
        () => {
          const doc = parseMarkdown(md);
          serializeMarkdown(doc);
        },
        `Edge case crashed: ${JSON.stringify(md).slice(0, 80)}`,
      ).not.toThrow();
    }
  });

  // Regression tests for seeds that previously found bugs
  for (const seed of FAILING_SEEDS) {
    it(`regression: seed=${seed}`, () => {
      const rng = new Rng(seed);
      const md = generateRandomMarkdown(rng);
      const doc1 = parseMarkdown(md);
      const serialized = serializeMarkdown(doc1);
      const doc2 = parseMarkdown(serialized);
      expect(doc2.toJSON()).toEqual(doc1.toJSON());
    });
  }
});

describe("Fuzz: random operations on PM documents", () => {
  it("random insertions, deletions, and mark toggles don't crash", () => {
    for (let i = 0; i < 100; i++) {
      const seed = i + 20000;
      const rng = new Rng(seed);
      const md = generateRandomMarkdown(rng, rng.range(2, 5));

      const doc = parseMarkdown(md);
      let state = EditorState.create({ doc, schema });

      // Perform random operations
      const opCount = rng.range(5, 20);
      for (let op = 0; op < opCount; op++) {
        try {
          const action = rng.int(5);
          const docSize = state.doc.content.size;
          if (docSize < 2) break;

          switch (action) {
            case 0: {
              // Insert text at random position
              const pos = rng.range(1, Math.max(1, docSize - 1));
              const resolved = state.doc.resolve(pos);
              if (resolved.parent.isTextblock) {
                state = state.apply(state.tr.insertText(randomWord(rng), pos));
              }
              break;
            }
            case 1: {
              // Delete a small range
              const from = rng.range(1, Math.max(1, docSize - 2));
              const to = Math.min(from + rng.range(1, 3), docSize - 1);
              try {
                state = state.apply(state.tr.delete(from, to));
              } catch {
                // Invalid range — skip
              }
              break;
            }
            case 2: {
              // Toggle a mark on a range
              const markTypes = Object.keys(schema.marks);
              if (markTypes.length > 0) {
                const markName = rng.pick(markTypes);
                const markType = schema.marks[markName]!;
                const from = rng.range(1, Math.max(1, docSize - 2));
                const to = Math.min(from + rng.range(1, 5), docSize - 1);
                try {
                  state = state.apply(state.tr.addMark(from, to, markType.create()));
                } catch {
                  // Invalid mark position — skip
                }
              }
              break;
            }
            case 3: {
              // Replace with a random text node
              const from = rng.range(1, Math.max(1, docSize - 2));
              const to = Math.min(from + rng.range(1, 3), docSize - 1);
              try {
                const text = schema.text(randomWord(rng));
                state = state.apply(state.tr.replaceWith(from, to, text));
              } catch {
                // Invalid replacement — skip
              }
              break;
            }
            case 4: {
              // Serialize the current document (check for crashes)
              serializeMarkdown(state.doc);
              break;
            }
          }
        } catch {
          // Some operations may produce invalid states — that's OK
          // We're testing that nothing crashes catastrophically
        }
      }

      // Final serialize should not crash
      expect(() => serializeMarkdown(state.doc)).not.toThrow();
    }
  });
});
