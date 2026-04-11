import { useCallback, useState } from "react";
import {
  type NodeViewComponentProps,
  useEditorEventCallback,
  useStopEvent,
} from "@handlewithcare/react-prosemirror";
import { cn } from "../../utils/cn";
import { useSystemDark } from "../../hooks/useSystemDark";
import {
  useThemeStore,
  lightCodeThemes,
  darkCodeThemes,
  getEffectiveScheme,
} from "../../stores/theme";
import type { CodeThemeColors } from "../../theme-metadata";
import codeThemeColors from "virtual:code-theme-colors";
import { FloatingMenu, Checkmark } from "../FloatingMenu";
import IconCodeBlocks from "~icons/material-symbols/code-blocks-outline-rounded";

/**
 * Mirrors the daisyUI ThemeSwatch (base-100 bg + base-content / primary
 * / secondary / accent dots) using hex colours extracted at build time.
 */
function CodeThemeSwatch({ themeId, className }: { themeId: string; className?: string }) {
  const c: CodeThemeColors | undefined = codeThemeColors[themeId];
  if (!c) return null;
  return (
    <div
      className={cn("grid shrink-0 grid-cols-2 gap-0.5 rounded-md p-1 shadow-sm", className)}
      style={{ backgroundColor: c.bg }}
    >
      <span className="size-1 rounded-full" style={{ backgroundColor: c.fg }} />
      <span className="size-1 rounded-full" style={{ backgroundColor: c.accent1 }} />
      <span className="size-1 rounded-full" style={{ backgroundColor: c.accent2 }} />
      <span className="size-1 rounded-full" style={{ backgroundColor: c.accent3 }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Theme list items                                                   */
/* ------------------------------------------------------------------ */

function CodeThemeItems<T extends string>({
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
        <CodeThemeSwatch themeId={t} />
        <span className="whitespace-nowrap">{t}</span>
        <Checkmark visible={active === t} />
      </button>
    </li>
  ));
}

/* ------------------------------------------------------------------ */
/*  Theme dropdown                                                     */
/* ------------------------------------------------------------------ */

function ThemeDropdown() {
  const mode = useThemeStore((state) => state.mode);
  const lightCodeTheme = useThemeStore((state) => state.lightCodeTheme);
  const darkCodeTheme = useThemeStore((state) => state.darkCodeTheme);
  const setLightCodeTheme = useThemeStore((state) => state.setLightCodeTheme);
  const setDarkCodeTheme = useThemeStore((state) => state.setDarkCodeTheme);
  const systemDark = useSystemDark();
  const scheme = getEffectiveScheme(mode, systemDark);

  return (
    <FloatingMenu
      renderTrigger={(ref, props) => (
        <button
          ref={ref}
          {...props}
          type="button"
          className="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100"
          aria-label="Change code theme"
        >
          <IconCodeBlocks width={14} height={14} aria-hidden="true" />
        </button>
      )}
      menuClass="w-fit"
    >
      {() => (
        <>
          <li className="menu-title text-xs">Syntax highlight</li>
          {scheme === "dark" ? (
            <CodeThemeItems
              themes={darkCodeThemes}
              active={darkCodeTheme}
              onSelect={setDarkCodeTheme}
            />
          ) : (
            <CodeThemeItems
              themes={lightCodeThemes}
              active={lightCodeTheme}
              onSelect={setLightCodeTheme}
            />
          )}
        </>
      )}
    </FloatingMenu>
  );
}

/* ------------------------------------------------------------------ */
/*  Language input                                                     */
/* ------------------------------------------------------------------ */

function LanguageInput({
  language,
  getPos,
}: {
  language: string | null;
  getPos: () => number | undefined;
}) {
  const [value, setValue] = useState(language ?? "");

  const commitLanguage = useEditorEventCallback((view, newLang: string) => {
    const pos = getPos();
    if (pos == null || !view) return;
    const trimmed = newLang.trim() || null;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { lang: trimmed }));
  });

  const handleCommit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed !== (language ?? "")) {
      commitLanguage(trimmed);
    }
  }, [value, language, commitLanguage]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="lang"
      spellCheck={false}
      style={{ width: `${Math.max(value.length, 4) + 1}ch` }}
      className="bg-transparent text-xs font-mono text-base-content/40 placeholder:text-base-content/20 focus:text-base-content/60 focus:outline-none"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Code block node view                                               */
/* ------------------------------------------------------------------ */

export function CodeBlockView({
  children,
  nodeProps,
  ref: nodeViewRef,
  ...props
}: NodeViewComponentProps) {
  const { node, getPos } = nodeProps;
  const language = node.attrs.lang as string | null;

  // Prevent ProseMirror from handling events inside non-editable controls
  useStopEvent((_, event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[contenteditable=false]")) return true;
    return false;
  });

  return (
    <div {...props} ref={nodeViewRef} className={cn("relative", props.className)}>
      <pre className="code-block">
        <div className="code-lang-label" contentEditable={false}>
          <LanguageInput language={language} getPos={getPos} />
        </div>
        <code
          ref={nodeProps.contentDOMRef}
          className={language ? `language-${language}` : undefined}
        >
          {children}
        </code>
      </pre>
      <div className="absolute top-2 right-2 z-10" contentEditable={false}>
        <ThemeDropdown />
      </div>
    </div>
  );
}
