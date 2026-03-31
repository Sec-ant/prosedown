import { useEffect, useSyncExternalStore } from "react";
import { cn } from "./lib/cn";
import {
  useThemeStore,
  lightThemes,
  darkThemes,
  getEffectiveScheme,
  type ThemeMode,
} from "./stores/theme";
import { FloatingMenu, Checkmark } from "./components/FloatingMenu";
import IconLightMode from "~icons/material-symbols/light-mode-outline-rounded";
import IconDarkMode from "~icons/material-symbols/dark-mode-outline-rounded";
import IconMonitor from "~icons/material-symbols/desktop-windows-outline-rounded";
import IconExpandMore from "~icons/material-symbols/expand-more-rounded";

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
        <span className="whitespace-nowrap">{t}</span>
        <Checkmark visible={active === t} />
      </button>
    </li>
  ));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ThemeToggle() {
  const { mode, lightTheme, darkTheme, setMode, setLightTheme, setDarkTheme } = useThemeStore();

  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);
  const scheme = getEffectiveScheme(mode, systemDark);

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

      {/* ---- Page theme picker ---- */}
      <FloatingMenu
        renderTrigger={(ref, props) => (
          <button
            ref={ref}
            {...props}
            type="button"
            className="btn btn-ghost btn-sm gap-1.5 px-1.5"
          >
            <ThemeSwatch className="border-base-content/10 group-hover:border-base-content/20 border transition-colors" />
            <IconExpandMore
              width={12}
              height={12}
              className="mt-px opacity-60"
              aria-hidden="true"
            />
          </button>
        )}
        menuClass="w-fit"
      >
        <li className="menu-title text-xs">Theme</li>
        {scheme === "dark" ? (
          <PageThemeItems themes={darkThemes} active={darkTheme} onSelect={setDarkTheme} />
        ) : (
          <PageThemeItems themes={lightThemes} active={lightTheme} onSelect={setLightTheme} />
        )}
      </FloatingMenu>
    </div>
  );
}
