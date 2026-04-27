/** localStorage: when "1", home calculator's "Calculate all" does not call audit APIs. */

export const CALCULATE_ALL_SKIP_AUDIT_KEY = "calc:skipAuditOnCalculateAll";
export const CALC_LOCAL_ONLY_CHANGED_EVENT = "calc:localOnlyAuditChanged";

export function getSkipAuditOnCalculateAll(): boolean {
  try {
    return localStorage.getItem(CALCULATE_ALL_SKIP_AUDIT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipAuditOnCalculateAll(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(CALCULATE_ALL_SKIP_AUDIT_KEY, "1");
    } else {
      localStorage.removeItem(CALCULATE_ALL_SKIP_AUDIT_KEY);
    }
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent(CALC_LOCAL_ONLY_CHANGED_EVENT, { detail: { value } }),
    );
  } catch {
    /* non-browser */
  }
}
