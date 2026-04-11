import { useState, type ReactNode } from "react";
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
  FloatingPortal,
  type Placement,
} from "@floating-ui/react";
import { cn } from "../utils/cn";
import IconCheck from "~icons/material-symbols/check-rounded";

/* ------------------------------------------------------------------ */
/*  Checkmark (shared by all theme menus)                              */
/* ------------------------------------------------------------------ */

export function Checkmark({ visible }: { visible: boolean }) {
  return (
    <IconCheck
      width={12}
      height={12}
      aria-hidden="true"
      className={cn("shrink-0", visible ? "visible" : "invisible")}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  FloatingMenu                                                       */
/* ------------------------------------------------------------------ */

/**
 * Dropdown menu using Floating UI.  Shared by the page theme picker
 * (ThemeToggle) and the code theme picker (CodeBlockView).
 *
 * Uses a render-prop for the trigger so the caller controls the button
 * content while the component manages positioning, interactions, and
 * the panel animation.
 */
export function FloatingMenu({
  renderTrigger,
  placement = "bottom-end",
  menuClass,
  children,
}: {
  /** Receives ref + interaction props; return the trigger element. */
  renderTrigger: (
    ref: (node: HTMLElement | null) => void,
    props: Record<string, unknown>,
  ) => ReactNode;
  /** Floating UI placement (default `"bottom-end"`). */
  placement?: Placement;
  /** Extra classes on the `<ul class="menu">` (e.g. width). */
  menuClass?: string;
  /** Menu items (`<li>` elements), or a lazy renderer invoked only while open. */
  children: ReactNode | (() => ReactNode);
}) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  return (
    <>
      {renderTrigger(refs.setReference, getReferenceProps())}

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="dropdown-content z-50 max-h-[min(30.5rem,calc(100vh-8.6rem))] overflow-x-hidden overflow-y-auto rounded-box border border-white/5 bg-base-200 text-base-content shadow-2xl outline outline-1 outline-black/5"
            {...getFloatingProps()}
          >
            <ul className={cn("menu", menuClass)}>
              {typeof children === "function" ? children() : children}
            </ul>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
