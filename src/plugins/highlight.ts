import { Plugin } from "prosemirror-state";
import { createHighlightPlugin } from "prosemirror-highlight";
import type { HighlightPluginState } from "prosemirror-highlight";
import { createParser, type Parser } from "prosemirror-highlight/shiki";
import type { BuiltinLanguage, BuiltinTheme, Highlighter } from "shiki";
import { useThemeStore, getEffectiveScheme } from "../stores/theme";

/* ------------------------------------------------------------------ */
/*  Module state                                                       */
/* ------------------------------------------------------------------ */

let highlighter: Highlighter | undefined;
let highlighterPromise: Promise<void> | undefined;
let parser: Parser | undefined;

/** The Shiki theme currently compiled into `parser`. */
let activeCodeTheme: string | undefined;

const loadedLanguages = new Set<string>();
const loadedThemes = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Lazy loaders                                                       */
/* ------------------------------------------------------------------ */

function loadHighlighter(): Promise<void> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki")
      .then((m) => m.createHighlighter({ themes: [], langs: [] }))
      .then((h) => {
        highlighter = h;
      });
  }
  return highlighterPromise;
}

async function loadLanguage(hl: Highlighter, language: string): Promise<void> {
  try {
    await hl.loadLanguage(language as BuiltinLanguage);
  } finally {
    loadedLanguages.add(language);
  }
}

async function loadTheme(hl: Highlighter, theme: string): Promise<void> {
  try {
    await hl.loadTheme(theme as BuiltinTheme);
  } finally {
    loadedThemes.add(theme);
  }
}

/* ------------------------------------------------------------------ */
/*  Effective code theme                                               */
/* ------------------------------------------------------------------ */

function getEffectiveCodeTheme(): string {
  const state = useThemeStore.getState();
  const systemDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const scheme = getEffectiveScheme(state.mode, systemDark);
  return scheme === "dark" ? state.darkCodeTheme : state.lightCodeTheme;
}

/* ------------------------------------------------------------------ */
/*  Lazy parser                                                        */
/* ------------------------------------------------------------------ */

/**
 * Lazy parser: loads the Shiki highlighter, themes, and languages on
 * demand.  Uses a single Shiki theme (not dual light/dark) so that
 * inline token colours are always correct — no CSS‑variable switching.
 */
const lazyParser: Parser = (options) => {
  if (!highlighter) {
    return loadHighlighter();
  }

  const codeTheme = getEffectiveCodeTheme();

  // Lazy-load the Shiki theme if it hasn't been loaded yet.
  if (!loadedThemes.has(codeTheme)) {
    return loadTheme(highlighter, codeTheme);
  }

  const language = options.language;
  if (language && !loadedLanguages.has(language)) {
    return loadLanguage(highlighter, language);
  }

  // Recreate the parser whenever the theme has changed.
  if (!parser || activeCodeTheme !== codeTheme) {
    activeCodeTheme = codeTheme;
    parser = createParser(highlighter, {
      theme: codeTheme as BuiltinTheme,
    });
  }

  return parser(options);
};

/* ------------------------------------------------------------------ */
/*  Plugins                                                            */
/* ------------------------------------------------------------------ */

/**
 * Use the plugin's own getState() to access its internal cache.
 *
 * NOTE: We cannot use a separate `new PluginKey("prosemirror-highlight")`
 * because prosemirror-state's `createKey()` appends an incrementing
 * counter — each PluginKey instance gets a unique key string, so a
 * second key would never resolve to the same state.
 */
function getHighlightState(editorState: import("prosemirror-state").EditorState) {
  return highlightPlugin.getState(editorState) as HighlightPluginState | undefined;
}

/** The main syntax-highlighting plugin. */
export const highlightPlugin = createHighlightPlugin({ parser: lazyParser });

/**
 * Companion plugin that watches the zustand theme store and the
 * system colour-scheme media query.  When the effective code theme
 * changes it:
 *  1. Pre-loads the new Shiki theme (if not yet loaded).
 *  2. Resets the parser so it will be recreated with the new theme.
 *  3. Clears the prosemirror-highlight decoration cache so every
 *     code block is re-parsed on the next refresh.
 *  4. Dispatches a refresh transaction.
 */
export const codeThemeSyncPlugin = new Plugin({
  view(editorView) {
    const mql =
      typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;

    async function sync() {
      const codeTheme = getEffectiveCodeTheme();
      if (codeTheme === activeCodeTheme) return;

      // Pre-load the new theme so the re-parse is synchronous.
      if (highlighter && !loadedThemes.has(codeTheme)) {
        await loadTheme(highlighter, codeTheme);
      }

      // Reset parser — will be recreated with new theme on next parse.
      parser = undefined;

      // Clear the highlight plugin's decoration cache.  Without this
      // the cached entries survive the refresh (no doc change ⇒
      // cache.invalidate() preserves everything) and the parser is
      // never called again.
      const pluginState = getHighlightState(editorView.state);
      if (pluginState) {
        editorView.state.doc.descendants((node, pos) => {
          if (node.type.isTextblock && node.type.name === "code_block") {
            pluginState.cache.remove(pos);
            return false;
          }
        });
      }

      editorView.dispatch(editorView.state.tr.setMeta("prosemirror-highlight-refresh", true));
    }

    const unsubStore = useThemeStore.subscribe(() => void sync());

    const onSystemChange = () => void sync();
    mql?.addEventListener("change", onSystemChange);

    return {
      destroy() {
        unsubStore();
        mql?.removeEventListener("change", onSystemChange);
      },
    };
  },
});
