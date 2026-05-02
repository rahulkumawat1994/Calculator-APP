import { createPortal } from "react-dom";
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";

export type ModalBackdrop = "dim" | "blurred";

export interface ModalProps {
  open: boolean;
  children: ReactNode;
  /** Fires when the dimmed overlay is clicked (not the panel). */
  onBackdropClick?: () => void;
  /**
   * Visual style for the overlay. "dim" matches the legacy 45% black scrim;
   * "blurred" is used for large admin-style dialogs.
   */
  backdrop?: ModalBackdrop;
  /** Additional classes for the fixed overlay (e.g. p-3 sm:p-4). */
  overlayClassName?: string;
}

const OVERLAY_BASE =
  "fixed inset-0 z-[20000] flex items-center justify-center overscroll-contain";

/** Tracks how many Modal instances are currently open so scroll-lock is
 *  released only when the last one closes (handles stacked modals). */
let openCount = 0;

/**
 * Full-viewport modal overlay, portaled to `document.body` with a stable z-index.
 * Locks background scroll while open.
 */
export function Modal({
  open,
  children,
  onBackdropClick,
  backdrop = "dim",
  overlayClassName = "p-4",
}: ModalProps) {
  // Scroll lock — runs whenever `open` changes or on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) {
      openCount++;
      if (openCount === 1) {
        document.body.style.overflow = "hidden";
        document.body.style.touchAction = "none";
      }
    }
    return () => {
      if (open) {
        openCount = Math.max(0, openCount - 1);
        if (openCount === 0) {
          document.body.style.overflow = "";
          document.body.style.touchAction = "";
        }
      }
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const style: CSSProperties | undefined =
    backdrop === "dim" ? { background: "rgba(0,0,0,0.45)" } : undefined;
  const blurClass =
    backdrop === "blurred" ? "bg-slate-900/50 backdrop-blur-[2px]" : "";

  return createPortal(
    <div
      className={`${OVERLAY_BASE} ${overlayClassName} ${blurClass}`
        .replace(/\s+/g, " ")
        .trim()}
      style={style}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdropClick?.();
      }}
      role="presentation"
    >
      {children}
    </div>,
    document.body
  );
}
