import type { ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

export type DangerActionDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  titleId: string;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Primary button shows loading state. */
  confirmLoading?: boolean;
  loadingLabel?: string;
  confirmDisabled?: boolean;
  /** Panel max width, e.g. max-w-[400px] */
  panelClassName?: string;
};

const PANEL =
  "w-full overflow-hidden rounded-[20px] border-2 border-[#dde8f0] bg-white shadow-2xl";

/**
 * Two-action destructive confirm (e.g. delete) with shared app chrome.
 */
export function DangerActionDialog({
  open,
  onClose,
  onConfirm,
  titleId,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmLoading = false,
  loadingLabel = "…",
  confirmDisabled = false,
  panelClassName = "max-w-[400px]",
}: DangerActionDialogProps) {
  return (
    <Modal open={open} onBackdropClick={onClose} backdrop="dim" overlayClassName="p-4">
      <div
        className={`${PANEL} ${panelClassName}`.replace(/\s+/g, " ").trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="border-b border-[#e7eef7] px-5 py-4">
          <h2
            id={titleId}
            className="text-[18px] font-extrabold text-red-700"
          >
            {title}
          </h2>
          {message != null && message !== "" ? (
            <div className="mt-2">{message}</div>
          ) : null}
        </div>
        <div className="flex gap-2 p-4">
          <Button
            type="button"
            variant="danger"
            className="flex-1 py-3 text-[15px] font-bold"
            onClick={onConfirm}
            disabled={confirmDisabled || confirmLoading}
          >
            {confirmLoading ? loadingLabel : confirmLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1 py-3 text-[15px] font-bold"
            onClick={onClose}
            disabled={confirmDisabled || confirmLoading}
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
