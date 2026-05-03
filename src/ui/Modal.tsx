import { createPortal } from "react-dom";
import { useEffect, useId } from "react";
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

/** One entry per open Modal instance; avoids counter drift under Strict Mode or stacked dialogs. */
const scrollLockOwners = new Set<string>();

function lockBodyScroll(ownerId: string) {
  if (typeof document === "undefined") return;
  scrollLockOwners.add(ownerId);
  if (scrollLockOwners.size === 1) {
    document.body.style.overflow = "hidden";
  }
}

function unlockBodyScroll(ownerId: string) {
  if (typeof document === "undefined") return;
  scrollLockOwners.delete(ownerId);
  if (scrollLockOwners.size === 0) {
    document.body.style.removeProperty("overflow");
  }
}

/**
 * Full-viewport modal overlay, portaled to `document.body` with a stable z-index.
 * Locks background scroll while open (`overflow: hidden` on `body` only —
 * avoids `touch-action: none`, which breaks touch scrolling inside modals on iOS).
 */
export function Modal({
  open,
  children,
  onBackdropClick,
  backdrop = "dim",
  overlayClassName = "p-4",
}: ModalProps) {
  const scrollLockId = useId();

  useEffect(() => {
    if (!open) return;
    lockBodyScroll(scrollLockId);
    return () => unlockBodyScroll(scrollLockId);
  }, [open, scrollLockId]);

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
