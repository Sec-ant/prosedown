import { defineConfig, type Plugin } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { playwright } from "vite-plus/test/browser-playwright";

/* ------------------------------------------------------------------ */
/*  Build-time Shiki theme colour extraction                           */
/* ------------------------------------------------------------------ */

/**
 * Vite plugin that provides `virtual:code-theme-colors` — a static
 * JSON mapping of every bundled Shiki theme to five representative
 * colours (bg, fg, accent1, accent2, accent3), mirroring daisyUI's
 * base-100/base-content/primary/secondary/accent swatch pattern.
 * Runs once at dev/build time; the consumer imports synchronously.
 */
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

      const { bundledThemes } = await import("shiki");
      type Colors = { bg: string; fg: string; accent1: string; accent2: string; accent3: string };
      const colors: Record<string, Colors> = {};

      await Promise.all(
        Object.entries(bundledThemes).map(async ([name, loader]) => {
          try {
            const mod = await loader();
            const raw = mod.default as Record<string, unknown>;
            const rawColors = raw["colors"] as Record<string, string> | undefined;
            const rawType = raw["type"] as string | undefined;

            const bg =
              rawColors?.["editor.background"] ?? (rawType === "dark" ? "#1e1e1e" : "#ffffff");
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
                    (c): c is string =>
                      typeof c === "string" && c.toLowerCase() !== fg.toLowerCase(),
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
            const f = "#bbbbbb";
            colors[name] = { bg: "#1e1e1e", fg: f, accent1: f, accent2: f, accent3: f };
          }
        }),
      );

      return `export default ${JSON.stringify(colors)}`;
    },
  };
}

/* ------------------------------------------------------------------ */

export default defineConfig({
  plugins: [
    codeThemeColorsPlugin(),
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
      exclude: ["src/**/__tests__/**"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts"],
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
