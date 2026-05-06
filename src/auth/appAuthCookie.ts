/** Cookie name for simple app login (not HttpOnly — client-set after env check). */
export const APP_AUTH_COOKIE_NAME = "isLoggedIn";

/** Five days, in seconds. */
export const APP_AUTH_COOKIE_MAX_AGE_SEC = 5 * 24 * 60 * 60;

export function hasAppAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return false;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    return k === APP_AUTH_COOKIE_NAME && (v === "true" || v === "1");
  });
}

function secureCookieSuffix(): string {
  if (typeof window === "undefined") return "";
  return window.location.protocol === "https:" ? "; Secure" : "";
}

export function setAppAuthCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${APP_AUTH_COOKIE_NAME}=true; Path=/; Max-Age=${APP_AUTH_COOKIE_MAX_AGE_SEC}; SameSite=Lax${secureCookieSuffix()}`;
}

export function clearAppAuthCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${APP_AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secureCookieSuffix()}`;
}
