import { useEffect, useState, type ReactNode } from "react";
import { hasAppAuthCookie } from "./appAuthCookie";
import { AppLoginModal } from "./AppLoginModal";

export function ProtectedAppSession({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => hasAppAuthCookie());

  useEffect(() => {
    setAuthed(hasAppAuthCookie());
  }, []);

  if (authed) {
    return <>{children}</>;
  }

  return (
    <>
      <AppLoginModal
        open
        allowDismiss={false}
        title="Sign in required"
        onClose={() => {}}
        onSuccess={() => setAuthed(true)}
      />
    </>
  );
}
