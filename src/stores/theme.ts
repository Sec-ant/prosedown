import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "auto";

/* ------------------------------------------------------------------ */
/*  daisyUI built-in themes                                            */
/* ------------------------------------------------------------------ */

export const lightThemes = [
  "light",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "retro",
  "cyberpunk",
  "valentine",
  "garden",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "cmyk",
  "autumn",
  "acid",
  "lemonade",
  "winter",
  "nord",
  "caramellatte",
  "silk",
] as const;

export const darkThemes = [
  "dark",
  "synthwave",
  "halloween",
  "forest",
  "aqua",
  "black",
  "luxury",
  "dracula",
  "business",
  "night",
  "coffee",
  "dim",
  "sunset",
  "abyss",
] as const;

export type LightTheme = (typeof lightThemes)[number];
export type DarkTheme = (typeof darkThemes)[number];

export const isDarkTheme = (name: string): name is DarkTheme =>
  (darkThemes as readonly string[]).includes(name);

/* ------------------------------------------------------------------ */
/*  Shiki code highlighting themes                                     */
/* ------------------------------------------------------------------ */

export const lightCodeThemes = [
  "ayu-light",
  "catppuccin-latte",
  "everforest-light",
  "github-light",
  "github-light-default",
  "github-light-high-contrast",
  "gruvbox-light-hard",
  "gruvbox-light-medium",
  "gruvbox-light-soft",
  "horizon-bright",
  "kanagawa-lotus",
  "light-plus",
  "material-theme-lighter",
  "min-light",
  "night-owl-light",
  "one-light",
  "rose-pine-dawn",
  "slack-ochin",
  "snazzy-light",
  "solarized-light",
  "vitesse-light",
] as const;

export const darkCodeThemes = [
  "andromeeda",
  "aurora-x",
  "ayu-dark",
  "ayu-mirage",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "dark-plus",
  "dracula",
  "dracula-soft",
  "everforest-dark",
  "github-dark",
  "github-dark-default",
  "github-dark-dimmed",
  "github-dark-high-contrast",
  "gruvbox-dark-hard",
  "gruvbox-dark-medium",
  "gruvbox-dark-soft",
  "horizon",
  "houston",
  "kanagawa-dragon",
  "kanagawa-wave",
  "laserwave",
  "material-theme",
  "material-theme-darker",
  "material-theme-ocean",
  "material-theme-palenight",
  "min-dark",
  "monokai",
  "night-owl",
  "nord",
  "one-dark-pro",
  "plastic",
  "poimandres",
  "red",
  "rose-pine",
  "rose-pine-moon",
  "slack-dark",
  "solarized-dark",
  "synthwave-84",
  "tokyo-night",
  "vesper",
  "vitesse-black",
  "vitesse-dark",
] as const;

export type LightCodeTheme = (typeof lightCodeThemes)[number];
export type DarkCodeTheme = (typeof darkCodeThemes)[number];

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

interface ThemeState {
  /** Active mode: explicit light, explicit dark, or follow system. */
  mode: ThemeMode;
  /** daisyUI theme used in light mode. */
  lightTheme: LightTheme;
  /** daisyUI theme used in dark mode. */
  darkTheme: DarkTheme;
  /** Shiki code theme used in light mode. */
  lightCodeTheme: LightCodeTheme;
  /** Shiki code theme used in dark mode. */
  darkCodeTheme: DarkCodeTheme;

  setMode: (mode: ThemeMode) => void;
  setLightTheme: (theme: LightTheme) => void;
  setDarkTheme: (theme: DarkTheme) => void;
  setLightCodeTheme: (theme: LightCodeTheme) => void;
  setDarkCodeTheme: (theme: DarkCodeTheme) => void;
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
