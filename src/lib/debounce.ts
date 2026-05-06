/**
 * Runs `fn` only after `waitMs` without new calls (trailing edge). Last arguments win.
 */
export function debounce<F extends (...args: never[]) => void>(
  fn: F,
  waitMs: number,
): ((...args: Parameters<F>) => void) & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const debouncedFn = (...args: Parameters<F>) => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      fn(...args);
    }, waitMs);
  };

  debouncedFn.cancel = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = undefined;
  };

  return debouncedFn;
}
