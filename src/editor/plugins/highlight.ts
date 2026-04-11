import { Plugin } from "prosemirror-state";
import { createHighlightPlugin } from "prosemirror-highlight";
import type { HighlightPluginState } from "prosemirror-highlight";
import { createParser, type Parser } from "prosemirror-highlight/shiki";
import type { BuiltinLanguage, BuiltinTheme, Highlighter } from "shiki";
import {
  useThemeStore,
  getEffectiveScheme,
  lightCodeThemes,
  darkCodeThemes,
  defaultLightCodeTheme,
  defaultDarkCodeTheme,
} from "../../stores/theme";

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
const unsupportedLanguages = new Set<string>();
const unsupportedThemes = new Set<string>();
const loadingLanguages = new Map<string, Promise<void>>();
const loadingThemes = new Map<string, Promise<void>>();

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

function loadLanguage(hl: Highlighter, language: string): Promise<void> {
  const existing = loadingLanguages.get(language);
  if (existing) return existing;

  const promise = hl
    .loadLanguage(language as BuiltinLanguage)
    .then(() => {
      loadedLanguages.add(language);
    })
    .catch(() => {
      unsupportedLanguages.add(language);
    })
    .finally(() => {
      loadingLanguages.delete(language);
    });

  loadingLanguages.set(language, promise);
  return promise;
}

function loadTheme(hl: Highlighter, theme: string): Promise<void> {
  const existing = loadingThemes.get(theme);
  if (existing) return existing;

  const promise = hl
    .loadTheme(theme as BuiltinTheme)
    .then(() => {
      loadedThemes.add(theme);
    })
    .catch(() => {
      unsupportedThemes.add(theme);
    })
    .finally(() => {
      loadingThemes.delete(theme);
    });

  loadingThemes.set(theme, promise);
  return promise;
}

async function loadCodeTheme(hl: Highlighter, theme: string): Promise<void> {
  await loadTheme(hl, theme);
  if (!loadedThemes.has(theme)) {
    const fallback = getFallbackCodeTheme();
    if (fallback !== theme) {
      await loadTheme(hl, fallback);
    }
  }
}

function getFallbackCodeTheme(): string {
  const state = useThemeStore.getState();
  const systemDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const scheme = getEffectiveScheme(state.mode, systemDark);
  const fallback = scheme === "dark" ? defaultDarkCodeTheme : defaultLightCodeTheme;
  const themes = scheme === "dark" ? darkCodeThemes : lightCodeThemes;
  return themes.includes(fallback) ? fallback : themes[0]!;
}

function getSafeCodeTheme(candidate: string, scheme: "light" | "dark"): string {
  const themes: readonly string[] = scheme === "dark" ? darkCodeThemes : lightCodeThemes;
  const fallback = scheme === "dark" ? defaultDarkCodeTheme : defaultLightCodeTheme;

  if (themes.includes(candidate) && !unsupportedThemes.has(candidate)) {
    return candidate;
  }

  if (themes.includes(fallback) && !unsupportedThemes.has(fallback)) {
    return fallback;
  }

  return themes.find((theme: string) => !unsupportedThemes.has(theme)) ?? fallback;
}

/* ------------------------------------------------------------------ */
/*  Effective code theme                                               */
/* ------------------------------------------------------------------ */

function getEffectiveCodeTheme(): string {
  const state = useThemeStore.getState();
  const systemDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const scheme = getEffectiveScheme(state.mode, systemDark);
  const codeTheme = scheme === "dark" ? state.darkCodeTheme : state.lightCodeTheme;
  return getSafeCodeTheme(codeTheme, scheme);
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
    return loadCodeTheme(highlighter, codeTheme);
  }

  const language =
    options.language && !unsupportedLanguages.has(options.language) ? options.language : undefined;
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

  if (!language) {
    const { language: _language, ...optionsWithoutLanguage } = options;
    return parser(optionsWithoutLanguage);
  }

  return parser({ ...options, language });
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
export const highlightPlugin = createHighlightPlugin({
  parser: lazyParser,
  nodeTypes: ["code"],
  languageExtractor: (node) => node.attrs.lang,
});

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
        await loadCodeTheme(highlighter, codeTheme);
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
          if (node.type.isTextblock && node.type.name === "code") {
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
