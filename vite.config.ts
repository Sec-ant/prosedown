import { defineConfig, type Plugin } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { playwright } from "vite-plus/test/browser-playwright";
import type { CodeThemeColors, ThemeLists } from "./src/theme-metadata";

async function loadCodeThemeColors(): Promise<Record<string, CodeThemeColors>> {
  const { bundledThemes } = await import("shiki");
  const colors: Record<string, CodeThemeColors> = {};

  await Promise.all(
    Object.entries(bundledThemes).map(async ([name, loader]) => {
      try {
        const mod = await loader();
        const raw = mod.default as Record<string, unknown>;
        const rawColors = raw["colors"] as Record<string, string> | undefined;
        const rawType = raw["type"] as string | undefined;

        const bg = rawColors?.["editor.background"] ?? (rawType === "dark" ? "#1e1e1e" : "#ffffff");
        const fg =
          rawColors?.["editor.foreground"] ??
          rawColors?.["foreground"] ??
          (rawType === "dark" ? "#bbbbbb" : "#333333");

        type TmEntry = { scope?: unknown; settings?: { foreground?: string } };
        const tokenEntries = (raw["tokenColors"] ?? raw["settings"] ?? []) as TmEntry[];
        const tokenFgs = [
          ...new Set(
            tokenEntries
              .filter((tc) => tc.scope)
              .map((tc) => tc.settings?.foreground)
              .filter(
                (c): c is string => typeof c === "string" && c.toLowerCase() !== fg.toLowerCase(),
              ),
          ),
        ];

        colors[name] = {
          bg,
          fg,
          accent1: tokenFgs[0] ?? fg,
          accent2: tokenFgs[1] ?? fg,
          accent3: tokenFgs[2] ?? tokenFgs[0] ?? fg,
        };
      } catch {
        const fallback = "#bbbbbb";
        colors[name] = {
          bg: "#1e1e1e",
          fg: fallback,
          accent1: fallback,
          accent2: fallback,
          accent3: fallback,
        };
      }
    }),
  );

  return colors;
}

async function loadCodeThemeLists(): Promise<ThemeLists> {
  const { bundledThemesInfo } = await import("shiki");
  return {
    light: bundledThemesInfo.filter((theme) => theme.type === "light").map((theme) => theme.id),
    dark: bundledThemesInfo.filter((theme) => theme.type === "dark").map((theme) => theme.id),
  };
}

async function loadPageThemeLists(): Promise<ThemeLists> {
  const [{ default: daisyuiThemes }, { default: daisyuiThemeOrder }] = await Promise.all([
    import("daisyui/theme/object.js"),
    import("daisyui/functions/themeOrder.js"),
  ]);
  const themes = daisyuiThemes as Record<string, { "color-scheme"?: string }>;

  return {
    light: daisyuiThemeOrder.filter((name) => themes[name]?.["color-scheme"] === "light"),
    dark: daisyuiThemeOrder.filter((name) => themes[name]?.["color-scheme"] === "dark"),
  };
}

function codeThemeColorsPlugin(): Plugin {
  const virtualId = "virtual:code-theme-colors";
  const resolvedId = "\0" + virtualId;

  return {
    name: "code-theme-colors",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      return `export default ${JSON.stringify(await loadCodeThemeColors())}`;
    },
  };
}

function codeThemeListsPlugin(): Plugin {
  const virtualId = "virtual:code-theme-lists";
  const resolvedId = "\0" + virtualId;

  return {
    name: "code-theme-lists",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      return `export default ${JSON.stringify(await loadCodeThemeLists())}`;
    },
  };
}

function pageThemeListsPlugin(): Plugin {
  const virtualId = "virtual:page-theme-lists";
  const resolvedId = "\0" + virtualId;

  return {
    name: "page-theme-lists",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      return `export default ${JSON.stringify(await loadPageThemeLists())}`;
    },
  };
}

/* ------------------------------------------------------------------ */

export default defineConfig({
  plugins: [
    codeThemeColorsPlugin(),
    codeThemeListsPlugin(),
    pageThemeListsPlugin(),
    react(),
    tailwindcss(),
    Icons({ compiler: "jsx", jsx: "react" }),
  ],
  staged: {
    "*": "vp check --fix",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["tests/**"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.browser.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["tests/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
