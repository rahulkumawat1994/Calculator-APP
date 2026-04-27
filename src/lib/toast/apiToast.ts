import { toast, type ToastOptions } from "react-toastify";

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

/** Toast only on failure (never call for success paths). */
export function toastApiError(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
  options?: Pick<ToastOptions, "toastId">,
): void {
  toast.error(apiErrorMessage(err, fallback), {
    toastId: options?.toastId,
  });
}
