import type { Node as PMNode } from "prosemirror-model";
import { schema } from "../../src/markdown";

export class Rng {
  private s: [number, number, number, number];

  constructor(seed: number) {
    let s = seed | 0;
    const sm = () => {
      s = (s + 0x9e3779b9) | 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      return t >>> 0;
    };
    this.s = [sm(), sm(), sm(), sm()];
  }

  next(): number {
    const s = this.s;
    const t = s[3];
    let r = s[0];
    s[3] = s[2];
    s[2] = s[1];
    s[1] = r;
    r ^= r << 11;
    r ^= r >>> 8;
    s[0] = r ^ t ^ (t >>> 19);
    return (s[0] >>> 0) / 0x100000000;
  }

  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

const WORDS = [
  "hello",
  "world",
  "foo",
  "bar",
  "baz",
  "the",
  "quick",
  "brown",
  "fox",
  "jumps",
  "over",
  "lazy",
  "dog",
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "CJK测试",
  "日本語",
  "한국어",
  "emoji🎉",
  "special<>&",
  "back\\slash",
  "pipe|char",
  "tab\there",
];

const LANGUAGES = ["", "js", "ts", "python", "rust", "go", "html", "css", "json", "bash"];

export function randomWord(rng: Rng): string {
  return rng.pick(WORDS);
}

function randomWords(rng: Rng, min = 1, max = 8): string {
  const count = rng.range(min, max);
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(randomWord(rng));
  return words.join(" ");
}

function randomInline(rng: Rng): string {
  const parts: string[] = [];
  const segmentCount = rng.range(1, 5);

  for (let i = 0; i < segmentCount; i++) {
    const text = randomWords(rng, 1, 4);
    switch (rng.int(8)) {
      case 0:
        parts.push(`**${text}**`);
        break;
      case 1:
        parts.push(`*${text}*`);
        break;
      case 2:
        parts.push(`\`${text}\``);
        break;
      case 3:
        parts.push(`~~${text}~~`);
        break;
      case 4:
        parts.push(`[${text}](https://example.com/${rng.int(100)})`);
        break;
      case 5:
        parts.push(`![${text}](https://example.com/img${rng.int(100)}.png)`);
        break;
      default:
        parts.push(text);
        break;
    }
  }
  return parts.join(" ");
}

function randomHeading(rng: Rng): string {
  return `${"#".repeat(rng.range(1, 6))} ${randomWords(rng, 1, 5)}`;
}

function randomParagraph(rng: Rng): string {
  return randomInline(rng);
}

function randomBlockquote(rng: Rng): string {
  const lines: string[] = [];
  for (let i = 0; i < rng.range(1, 3); i++) {
    lines.push(`> ${randomInline(rng)}`);
  }
  return lines.join("\n");
}

function randomCodeBlock(rng: Rng): string {
  const lines = [`\`\`\`${rng.pick(LANGUAGES)}`];
  for (let i = 0; i < rng.range(1, 5); i++) {
    lines.push(randomWords(rng, 1, 6));
  }
  lines.push("```");
  return lines.join("\n");
}

function randomBulletList(rng: Rng): string {
  const items: string[] = [];
  for (let i = 0; i < rng.range(1, 5); i++) {
    items.push(`- ${randomInline(rng)}`);
  }
  return items.join("\n");
}

function randomOrderedList(rng: Rng): string {
  const start = rng.range(1, 10);
  const items: string[] = [];
  for (let i = 0; i < rng.range(1, 5); i++) {
    items.push(`${start + i}. ${randomInline(rng)}`);
  }
  return items.join("\n");
}

function randomTaskList(rng: Rng): string {
  const items: string[] = [];
  for (let i = 0; i < rng.range(1, 4); i++) {
    items.push(`- [${rng.chance(0.5) ? "x" : " "}] ${randomWords(rng, 1, 4)}`);
  }
  return items.join("\n");
}

function randomTableWord(rng: Rng): string {
  return rng.pick(WORDS.filter((word) => !word.includes("|")));
}

function randomTableWords(rng: Rng, min = 1, max = 3): string {
  const words: string[] = [];
  for (let i = 0; i < rng.range(min, max); i++) words.push(randomTableWord(rng));
  return words.join(" ");
}

function randomTable(rng: Rng): string {
  const cols = rng.range(2, 5);
  const rows = rng.range(1, 4);
  const header =
    "| " + Array.from({ length: cols }, () => randomTableWords(rng, 1, 2)).join(" | ") + " |";
  const separator = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const body: string[] = [];

  for (let row = 0; row < rows; row++) {
    body.push("| " + Array.from({ length: cols }, () => randomTableWords(rng)).join(" | ") + " |");
  }

  return [header, separator, ...body].join("\n");
}

function randomNestedList(rng: Rng): string {
  const lines: string[] = [];
  for (let i = 0; i < rng.range(2, 4); i++) {
    lines.push(`- ${randomWords(rng, 1, 3)}`);
    if (rng.chance(0.6)) {
      for (let j = 0; j < rng.range(1, 3); j++) {
        lines.push(`  - ${randomWords(rng, 1, 3)}`);
      }
    }
  }
  return lines.join("\n");
}

const BLOCK_GENERATORS = [
  randomParagraph,
  randomHeading,
  randomBlockquote,
  randomCodeBlock,
  randomBulletList,
  randomOrderedList,
  randomTaskList,
  randomTable,
  () => "---",
  randomNestedList,
] as const;

export function generateRandomMarkdown(rng: Rng, blockCount?: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < (blockCount ?? rng.range(3, 12)); i++) {
    blocks.push(rng.pick(BLOCK_GENERATORS)(rng));
  }
  return `${blocks.join("\n\n")}\n`;
}

export function validatePMNode(node: PMNode): string[] {
  const errors: string[] = [];

  node.descendants((child, _pos, parent) => {
    if (!schema.nodes[child.type.name]) {
      errors.push(`Unknown node type: ${child.type.name}`);
    }
    for (const mark of child.marks) {
      if (!schema.marks[mark.type.name]) {
        errors.push(`Unknown mark type: ${mark.type.name}`);
      }
    }
    if (parent && !parent.type.validContent(parent.content)) {
      errors.push(`${parent.type.name} has invalid content`);
    }
  });

  if (!node.type.validContent(node.content)) {
    errors.push(`${node.type.name} has invalid content`);
  }

  return errors;
}
