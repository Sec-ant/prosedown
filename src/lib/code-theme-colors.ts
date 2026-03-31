import themeColors from "virtual:code-theme-colors";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CodeThemeColors {
  bg: string;
  fg: string;
  accent1: string;
  accent2: string;
  accent3: string;
}

/* ------------------------------------------------------------------ */
/*  Public API — synchronous, pre-computed at build time               */
/* ------------------------------------------------------------------ */

/**
 * Static map of every bundled Shiki theme to its five representative
 * colours.  Extracted at Vite build/dev time via the
 * `codeThemeColorsPlugin` in vite.config.ts — zero runtime cost.
 */
export const codeThemeColors: Readonly<Record<string, CodeThemeColors>> = themeColors;
