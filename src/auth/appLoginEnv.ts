/**
 * Credentials for the simple `/statement` + `/admin` login (Vite client env).
 * Set in `.env` / Vercel: `VITE_APP_LOGIN_USERNAME` and `VITE_APP_LOGIN_PASSWORD`.
 * These are embedded in the client bundle — use only as a light gate, not for secrets that must stay server-only.
 */
export function getExpectedAppLogin(): { username: string; password: string } | null {
  const username = String(import.meta.env.VITE_APP_LOGIN_USERNAME ?? "").trim();
  const password = String(import.meta.env.VITE_APP_LOGIN_PASSWORD ?? "");
  if (username.length === 0 || password.length === 0) return null;
  return { username, password };
}
