import { FirebaseError } from "firebase/app";

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * True for transient Firestore / network conditions where a short retry often succeeds.
 */
export function isRetryableFirestoreOrNetworkError(e: unknown): boolean {
  if (e instanceof Error && e.message === "timeout") return true;

  const msg = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|NETWORK_ERROR|ERR_NETWORK|timeout/i.test(msg)) {
    return true;
  }

  if (e instanceof FirebaseError) {
    const code = e.code;
    if (
      code === "permission-denied" ||
      code === "unauthenticated" ||
      code === "invalid-argument"
    ) {
      return false;
    }
    if (
      /unavailable|deadline-exceeded|resource-exhausted|aborted|internal|cancelled/i.test(
        code
      )
    ) {
      return true;
    }
  }

  const code =
    e && typeof e === "object" && "code" in e
      ? String((e as { code: unknown }).code)
      : "";
  if (/permission-denied|unauthenticated/i.test(code)) return false;
  if (/unavailable|deadline-exceeded|resource-exhausted|aborted|internal/i.test(code)) {
    return true;
  }

  return false;
}

/**
 * Runs `fn` up to `maxAttempts` times with exponential backoff between failures.
 */
export async function withFirestoreRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; initialDelayMs?: number }
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const initialDelayMs = opts?.initialDelayMs ?? 500;
  let last: unknown;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const canRetry =
        i < maxAttempts - 1 && isRetryableFirestoreOrNetworkError(e);
      if (!canRetry) throw e;
      await sleep(initialDelayMs * Math.pow(2, i));
    }
  }

  throw last;
}
