import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "./lib/cn";
import { useThemeStore, lightCodeThemes, darkCodeThemes, getEffectiveScheme } from "./stores/theme";
import IconCodeBlocks from "~icons/material-symbols/code-blocks-outline-rounded";

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
/*  Checkmark                                                          */
/* ------------------------------------------------------------------ */

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

/**
 * Generic code-theme list items — preserves the correlation between
 * themes/active/onSelect so no `as never` cast is needed.
 */
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
        <span className="w-36 truncate text-xs">{t}</span>
        <Checkmark visible={active === t} />
      </button>
    </li>
  ));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Floating overlay that appears on code blocks when hovered.
 * Shows a small palette button that opens a Shiki theme picker
 * dropdown, positioned at the top-right of the code block.
 *
 * Must be rendered inside the same positioned container as the
 * ProseMirror editor (a parent with `position: relative`).
 */
export function CodeBlockThemeOverlay() {
  const { mode, lightCodeTheme, darkCodeTheme, setLightCodeTheme, setDarkCodeTheme } =
    useThemeStore();

  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);
  const scheme = getEffectiveScheme(mode, systemDark);

  // Track the hovered code block element
  const [hoveredBlock, setHoveredBlock] = useState<HTMLElement | null>(null);
  // Whether the dropdown is open (keeps overlay visible even if mouse leaves block)
  const [open, setOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Position state (relative to viewport, for portal)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Update position when hovered block changes or on scroll
  const updatePosition = useCallback(() => {
    const el = hoveredBlock;
    if (!el) {
      setPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.top + 6, right: window.innerWidth - rect.right + 8 });
  }, [hoveredBlock]);

  useEffect(() => {
    updatePosition();
    if (!hoveredBlock) return;
    // Reposition on scroll / resize
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [hoveredBlock, updatePosition]);

  // Event delegation: detect hover on .code-block elements
  useEffect(() => {
    const editor = document.querySelector(".ProseMirror") as HTMLElement | null;
    if (!editor) return;

    function onPointerOver(e: PointerEvent) {
      const block = (e.target as HTMLElement).closest(".code-block") as HTMLElement | null;
      if (block) {
        setHoveredBlock(block);
      }
    }

    function onPointerLeave(e: PointerEvent) {
      // Don't dismiss if moving to the overlay
      const related = e.relatedTarget as HTMLElement | null;
      if (overlayRef.current?.contains(related)) return;
      if (dropdownRef.current?.contains(related)) return;
      setHoveredBlock(null);
      setOpen(false);
    }

    editor.addEventListener("pointerover", onPointerOver);
    editor.addEventListener("pointerleave", onPointerLeave);

    return () => {
      editor.removeEventListener("pointerover", onPointerOver);
      editor.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (overlayRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const visible = hoveredBlock && pos;
  if (!visible) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={cn(
        "pointer-events-auto fixed z-40 transition-opacity duration-150",
        hoveredBlock ? "opacity-100" : "opacity-0",
      )}
      style={{ top: pos.top, right: pos.right }}
      onPointerLeave={(e) => {
        // Don't dismiss if moving back to the code block or to the dropdown
        const related = e.relatedTarget as HTMLElement | null;
        if (hoveredBlock?.contains(related)) return;
        if (dropdownRef.current?.contains(related)) return;
        if (!open) {
          setHoveredBlock(null);
        }
      }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change code theme"
      >
        <IconCodeBlocks width={14} height={14} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className="absolute top-full right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-box border border-white/5 bg-base-200 text-base-content shadow-2xl outline outline-1 outline-black/5"
          onPointerLeave={(e) => {
            const related = e.relatedTarget as HTMLElement | null;
            if (overlayRef.current?.contains(related)) return;
            if (hoveredBlock?.contains(related)) return;
            setOpen(false);
            setHoveredBlock(null);
          }}
        >
          <ul className="menu w-52">
            <li className="menu-title text-xs">Code highlight</li>
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
          </ul>
        </div>
      )}
    </div>,
    document.body,
  );
}
