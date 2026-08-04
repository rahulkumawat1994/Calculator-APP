import { Modal } from "../ui";

export type ClearConfirmModalProps = {
  canSaveBeforeClear: boolean;
  canPersistToHistory: boolean;
  saving: boolean;
  hasSavedResults: boolean;
  onSaveThenClear: () => void;
  onClear: () => void;
  onCancel: () => void;
};

export function ClearConfirmModal({
  canSaveBeforeClear,
  canPersistToHistory,
  saving,
  hasSavedResults,
  onSaveThenClear,
  onClear,
  onCancel,
}: ClearConfirmModalProps) {
  return (
    <Modal
      open
      onBackdropClick={() => {
        if (!saving) onCancel();
      }}
      backdrop="blurred"
      overlayClassName="p-4 pc-modal-overlay"
    >
      <div
        className="pc-modal"
        role="dialog"
        aria-labelledby="clear-dialog-title"
        aria-modal="true"
      >
        <div className="pc-modal__body">
          <div className="pc-modal__icon" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </div>
          <h2 id="clear-dialog-title" className="pc-modal__title">
            Clear everything?
          </h2>
          <p className="pc-modal__desc">
            {canSaveBeforeClear
              ? "You have calculated results that are not saved to History yet. Save them first, or clear without saving."
              : hasSavedResults
                ? "This will remove all users, pasted text, and the on-screen summary. Your data is already saved in History."
                : "You have pasted text or extra user boxes. This will remove all of it."}
          </p>
        </div>
        <div className="pc-modal__actions">
          {canSaveBeforeClear && (
            <button
              type="button"
              disabled={saving || !canPersistToHistory}
              onClick={onSaveThenClear}
              className={`pc-modal__btn pc-modal__btn--primary${saving ? " pc-modal__btn--loading" : ""}`}
            >
              {saving ? (
                <>
                  <span className="pc-modal__spinner" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save to History & clear"
              )}
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={onClear}
            className="pc-modal__btn pc-modal__btn--danger"
          >
            Clear without saving
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="pc-modal__btn pc-modal__btn--ghost"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
