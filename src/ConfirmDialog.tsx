import { createPortal } from "react-dom";

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
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-20000 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
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
          <p className="mt-2 text-[13px] leading-snug text-gray-600 whitespace-pre-wrap">
            {message}
          </p>
        </div>
        <div className="flex gap-2 p-4">
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-[12px] py-3 text-[15px] font-bold text-white active:opacity-90 ${
              danger ? "bg-red-600" : "bg-[#1d6fb8]"
            }`}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-[12px] bg-gray-100 py-3 text-[15px] font-semibold text-gray-700 active:opacity-90"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
