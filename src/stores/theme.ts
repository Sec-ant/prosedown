import { create } from "zustand";
import { persist } from "zustand/middleware";
import daisyuiThemes from "daisyui/theme/object.js";
// @ts-expect-error — daisyui/functions/themeOrder.js has no type declarations
import daisyuiThemeOrder from "daisyui/functions/themeOrder.js";
import { bundledThemesInfo } from "shiki";

export type ThemeMode = "light" | "dark" | "auto";

/* ------------------------------------------------------------------ */
/*  daisyUI built-in themes (derived from package metadata)            */
/* ------------------------------------------------------------------ */

const themeOrder: string[] = daisyuiThemeOrder;

export const lightThemes = themeOrder.filter(
  (name) => daisyuiThemes[name]?.["color-scheme"] === "light",
);

export const darkThemes = themeOrder.filter(
  (name) => daisyuiThemes[name]?.["color-scheme"] === "dark",
);

export const isDarkTheme = (name: string): boolean => darkThemes.includes(name);

/* ------------------------------------------------------------------ */
/*  Shiki code highlighting themes (derived from package metadata)     */
/* ------------------------------------------------------------------ */

export const lightCodeThemes = bundledThemesInfo.filter((t) => t.type === "light").map((t) => t.id);

export const darkCodeThemes = bundledThemesInfo.filter((t) => t.type === "dark").map((t) => t.id);

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

interface ThemeState {
  /** Active mode: explicit light, explicit dark, or follow system. */
  mode: ThemeMode;
  /** daisyUI theme used in light mode. */
  lightTheme: string;
  /** daisyUI theme used in dark mode. */
  darkTheme: string;
  /** Shiki code theme used in light mode. */
  lightCodeTheme: string;
  /** Shiki code theme used in dark mode. */
  darkCodeTheme: string;

  setMode: (mode: ThemeMode) => void;
  setLightTheme: (theme: string) => void;
  setDarkTheme: (theme: string) => void;
  setLightCodeTheme: (theme: string) => void;
  setDarkCodeTheme: (theme: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "auto",
      lightTheme: "light",
      darkTheme: "dark",
      lightCodeTheme: "github-light",
      darkCodeTheme: "github-dark",

      setMode: (mode) => set({ mode }),
      setLightTheme: (lightTheme) => set({ lightTheme }),
      setDarkTheme: (darkTheme) => set({ darkTheme }),
      setLightCodeTheme: (lightCodeTheme) => set({ lightCodeTheme }),
      setDarkCodeTheme: (darkCodeTheme) => set({ darkCodeTheme }),
    }),
    { name: "prosedown-theme" },
  ),
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Resolve mode + system preference to a concrete "light" | "dark". */
export function getEffectiveScheme(mode: ThemeMode, systemDark: boolean): "light" | "dark" {
  if (mode === "auto") return systemDark ? "dark" : "light";
  return mode;
}
