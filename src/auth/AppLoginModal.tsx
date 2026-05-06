import { useId, useState, type FormEvent } from "react";
import { getExpectedAppLogin } from "./appLoginEnv";
import { setAppAuthCookie } from "./appAuthCookie";
import { Button, Card, Modal } from "@/ui";

export type AppLoginModalProps = {
  open: boolean;
  onClose: () => void;
  /** When false, backdrop does not close the modal (protected routes). */
  allowDismiss?: boolean;
  onSuccess: () => void;
  title?: string;
};

export function AppLoginModal({
  open,
  onClose,
  allowDismiss = true,
  onSuccess,
  title = "Sign in",
}: AppLoginModalProps) {
  const titleId = useId();
  const userFieldId = useId();
  const passFieldId = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const expected = getExpectedAppLogin();
    if (!expected) {
      setError(
        "Login is not configured. Set VITE_APP_LOGIN_USERNAME and VITE_APP_LOGIN_PASSWORD in your environment, then rebuild.",
      );
      return;
    }
    if (username.trim() !== expected.username || password !== expected.password) {
      setError("Incorrect username or password.");
      return;
    }
    setSubmitting(true);
    try {
      setAppAuthCookie();
      setUsername("");
      setPassword("");
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onBackdropClick={allowDismiss ? onClose : undefined}
      backdrop="dim"
      overlayClassName="p-4"
    >
      <Card
        surface="panel"
        className="w-full max-w-[400px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="border-b border-[#e7eef7] px-5 py-4">
          <h2 id={titleId} className="text-[18px] font-extrabold text-[#1a1a1a]">
            {title}
          </h2>
          <p className="mt-2 text-[13px] leading-snug text-gray-600">
            Enter the app username and password. Your session is stored in a cookie for 5 days.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
          <div>
            <label htmlFor={userFieldId} className="block text-[12px] font-bold text-gray-600">
              Username
            </label>
            <input
              id={userFieldId}
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#1a1a1a] shadow-sm outline-none focus:border-[#1d6fb8] focus:ring-2 focus:ring-[#1d6fb8]/25"
            />
          </div>
          <div>
            <label htmlFor={passFieldId} className="block text-[12px] font-bold text-gray-600">
              Password
            </label>
            <input
              id={passFieldId}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#1a1a1a] shadow-sm outline-none focus:border-[#1d6fb8] focus:ring-2 focus:ring-[#1d6fb8]/25"
            />
          </div>
          {error ? (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
          ) : null}
          <div className="flex flex-col gap-2 pt-1">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              className="w-full py-3 text-[15px] font-bold"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
            {allowDismiss ? (
              <Button type="button" variant="outline" onClick={onClose} className="w-full py-3 text-[15px] font-semibold">
                Cancel
              </Button>
            ) : (
              <a
                href="/"
                className="block w-full rounded-[12px] border-2 border-gray-200 bg-white py-3 text-center text-[15px] font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                ← Back to calculator
              </a>
            )}
          </div>
        </form>
      </Card>
    </Modal>
  );
}
