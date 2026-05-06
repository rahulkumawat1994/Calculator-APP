import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once after idle window", async () => {
    const fn = vi.fn();
    const d = debounce(fn as (...a: unknown[]) => void, 100);
    d();
    d();
    d();
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents run", async () => {
    const fn = vi.fn();
    const d = debounce(fn as (...a: unknown[]) => void, 100);
    d();
    d.cancel();
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).not.toHaveBeenCalled();
  });
});
