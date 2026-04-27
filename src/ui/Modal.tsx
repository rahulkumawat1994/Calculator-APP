import { createPortal } from "react-dom";
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

/**
 * Full-viewport modal overlay, portaled to `document.body` with a stable z-index.
 */
export function Modal({
  open,
  children,
  onBackdropClick,
  backdrop = "dim",
  overlayClassName = "p-4",
}: ModalProps) {
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
