import { useEffect, useSyncExternalStore } from "react";
import { cn } from "./lib/cn";
import {
  useThemeStore,
  lightThemes,
  darkThemes,
  getEffectiveScheme,
  type ThemeMode,
} from "./stores/theme";
import IconLightMode from "~icons/material-symbols/light-mode-outline-rounded";
import IconDarkMode from "~icons/material-symbols/dark-mode-outline-rounded";
import IconMonitor from "~icons/material-symbols/desktop-windows-outline-rounded";

/* ------------------------------------------------------------------ */
/*  System colour-scheme                                               */
/* ------------------------------------------------------------------ */

const mql =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;

function subscribeSystemDark(cb: () => void) {
  mql?.addEventListener("change", cb);
  return () => mql?.removeEventListener("change", cb);
}

function getSystemDark() {
  return mql?.matches ?? false;
}

/* ------------------------------------------------------------------ */
/*  Apply daisyUI theme to <html>                                      */
/* ------------------------------------------------------------------ */

function applyPageTheme(mode: ThemeMode, light: string, dark: string, systemDark: boolean) {
  const root = document.documentElement;
  if (mode === "auto") {
    const theme = systemDark ? dark : light;
    const fallback = systemDark ? "dark" : "light";
    if (theme !== fallback) {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
  } else {
    root.setAttribute("data-theme", mode === "light" ? light : dark);
  }
}

/* ------------------------------------------------------------------ */
/*  Shared pieces                                                      */
/* ------------------------------------------------------------------ */

const modes: { value: ThemeMode; label: string; Icon: React.FC<React.SVGProps<SVGSVGElement>> }[] =
  [
    { value: "light", label: "Light", Icon: IconLightMode },
    { value: "auto", label: "System", Icon: IconMonitor },
    { value: "dark", label: "Dark", Icon: IconDarkMode },
  ];

/**
 * Generic theme list items — preserves the correlation between
 * themes/active/onSelect so no `as never` cast is needed.
 */
function PageThemeItems<T extends string>({
  themes,
  active,
  onSelect,
}: {
  themes: readonly T[];
  active: T;
  onSelect: (theme: T) => void;
}) {
  return themes.map((t) => (
    <li key={t}>
      <button
        type="button"
        className={cn("gap-3 px-2", active === t && "[&_svg]:visible")}
        onClick={() => onSelect(t)}
      >
        <ThemeSwatch theme={t} />
        <span className="w-32 truncate">{t}</span>
        <Checkmark visible={active === t} />
      </button>
    </li>
  ));
}

/** Checkmark shown on the active theme row. */
function Checkmark({ visible }: { visible: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-3 shrink-0", visible ? "visible" : "invisible")}
    >
      <path d="M20.285 2l-11.285 11.567-5.286-5.011-3.714 3.716 9 8.728 15-15.285z" />
    </svg>
  );
}

/** 2x2 colour swatch — shows the theme's base-content, primary, secondary, accent. */
function ThemeSwatch({ theme, className }: { theme?: string; className?: string }) {
  return (
    <div
      data-theme={theme}
      className={cn(
        "grid shrink-0 grid-cols-2 gap-0.5 rounded-md bg-base-100 p-1 shadow-sm",
        className,
      )}
    >
      <span className="size-1 rounded-full bg-base-content" />
      <span className="size-1 rounded-full bg-primary" />
      <span className="size-1 rounded-full bg-secondary" />
      <span className="size-1 rounded-full bg-accent" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ThemeToggle() {
  const { mode, lightTheme, darkTheme, setMode, setLightTheme, setDarkTheme } = useThemeStore();

  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);
  const scheme = getEffectiveScheme(mode, systemDark);

  // Theme list/setter are selected per-scheme (see PageThemeItems below)

  // Sync <html data-theme>
  useEffect(() => {
    applyPageTheme(mode, lightTheme, darkTheme, systemDark);
  }, [mode, lightTheme, darkTheme, systemDark]);

  return (
    <div className="flex items-center gap-1">
      {/* Mode toggle: light / auto / dark */}
      <div className="join" role="radiogroup" aria-label="Theme mode">
        {modes.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            className={cn(
              "join-item btn btn-ghost btn-sm btn-square",
              mode === value && "btn-active",
            )}
            onClick={() => setMode(value)}
            aria-label={`${label} theme`}
            aria-pressed={mode === value}
          >
            <Icon width={16} height={16} aria-hidden="true" />
          </button>
        ))}
      </div>

      {/* ---- Page theme picker (daisyUI-style) ---- */}
      <div className="dropdown dropdown-end">
        {/* biome-ignore lint/a11y/useSemanticElements: daisyUI dropdown requires tabIndex on div trigger */}
        <button type="button" tabIndex={0} className="btn btn-ghost btn-sm gap-1.5 px-1.5">
          <ThemeSwatch className="border-base-content/10 group-hover:border-base-content/20 border transition-colors" />
          <svg
            width="12px"
            height="12px"
            className="mt-px size-2 fill-current opacity-60"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 2048 2048"
            aria-hidden="true"
          >
            <path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z" />
          </svg>
        </button>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: daisyUI dropdown requires tabIndex on content */}
        <div
          tabIndex={0}
          className="dropdown-content z-50 max-h-[min(30.5rem,calc(100vh-8.6rem))] overflow-x-hidden overflow-y-auto rounded-box border border-white/5 bg-base-200 text-base-content shadow-2xl outline outline-1 outline-black/5"
        >
          <ul className="menu w-56">
            <li className="menu-title text-xs">Theme</li>
            {scheme === "dark" ? (
              <PageThemeItems themes={darkThemes} active={darkTheme} onSelect={setDarkTheme} />
            ) : (
              <PageThemeItems themes={lightThemes} active={lightTheme} onSelect={setLightTheme} />
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
