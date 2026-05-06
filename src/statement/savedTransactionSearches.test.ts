import { describe, expect, it } from "vitest";
import {
  addSavedTransactionSearch,
  defaultLabelFromTransactionSearchRaw,
} from "./savedTransactionSearches";

describe("defaultLabelFromTransactionSearchRaw", () => {
  it("uses first comma-separated segment", () => {
    expect(defaultLabelFromTransactionSearchRaw("FOO, BAR")).toBe("FOO");
  });

  it("uses first line", () => {
    expect(defaultLabelFromTransactionSearchRaw("LINE1\nLINE2")).toBe("LINE1");
  });
});

describe("addSavedTransactionSearch", () => {
  it("rejects empty raw", () => {
    expect(addSavedTransactionSearch([], "  ", "")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects duplicate raw", () => {
    const items = [{ id: "1", label: "A", raw: "x" }];
    expect(addSavedTransactionSearch(items, "x", "B")).toEqual({ ok: false, reason: "duplicate" });
  });

  it("prepends new item", () => {
    const r = addSavedTransactionSearch([{ id: "1", label: "Old", raw: "old" }], "new", "N");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items[0]!.raw).toBe("new");
      expect(r.items[0]!.label).toBe("N");
      expect(r.items).toHaveLength(2);
    }
  });
});
