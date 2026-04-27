import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onBackdropClick={onCancel} backdrop="dim" overlayClassName="p-4">
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-[20px] border-2 border-[#dde8f0] bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b border-[#e7eef7] px-5 py-4">
          <h2
            className={`text-[18px] font-extrabold ${
              danger ? "text-red-700" : "text-[#1a1a1a]"
            }`}
          >
            {title}
          </h2>
          <p className="mt-2 text-[13px] leading-snug whitespace-pre-wrap text-gray-600">
            {message}
          </p>
        </div>
        <div className="flex gap-2 p-4">
          <Button
            variant={danger ? "danger" : "primary"}
            className="flex-1 py-3 text-[15px] font-bold"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button
            variant="secondary"
            className="flex-1 py-3 text-[15px] font-bold"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
