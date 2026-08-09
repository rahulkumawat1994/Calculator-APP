import { describe, expect, it, vi } from "vitest";
import {
  addStatementProfile,
  loadStatementProfileColumnBandDeltas,
  loadStatementProfiles,
  persistStatementProfileColumnBandDeltas,
  profileHasSavedColumnBandDeltas,
  removeStatementProfile,
  renameStatementProfile,
} from "./statementProfiles";
import type { StatementProfileColumnBandDeltas } from "./statementProfiles";

describe("statementProfiles", () => {
  it("addStatementProfile creates unique ids", () => {
    const base = loadStatementProfiles();
    const r = addStatementProfile(base, "Partner");
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.profiles.some((p) => p.name === "Partner")).toBe(true);
      expect(r.newId).toBeTruthy();
    }
  });

  it("rejects empty name", () => {
    const r = addStatementProfile(loadStatementProfiles(), "  ");
    expect(r).toEqual({ error: "Enter a name for this profile." });
  });

  it("renameStatementProfile updates display name", () => {
    const base = loadStatementProfiles();
    const added = addStatementProfile(base, "Partner");
    if ("error" in added) throw new Error("expected add to succeed");
    const renamed = renameStatementProfile(added.profiles, added.newId, "Spouse");
    expect("error" in renamed).toBe(false);
    if (!("error" in renamed)) {
      expect(renamed.profiles.find((p) => p.id === added.newId)?.name).toBe("Spouse");
    }
  });

  it("removeStatementProfile requires at least one profile", () => {
    const base = loadStatementProfiles();
    const r = removeStatementProfile(base, "me");
    expect(r).toEqual({ error: "Keep at least one profile." });
  });

  it("removeStatementProfile drops profile and returns fallback", () => {
    const base = loadStatementProfiles();
    const added = addStatementProfile(base, "Partner");
    if ("error" in added) throw new Error("expected add to succeed");
    const removed = removeStatementProfile(added.profiles, added.newId);
    expect("error" in removed).toBe(false);
    if (!("error" in removed)) {
      expect(removed.profiles.some((p) => p.id === added.newId)).toBe(false);
      expect(removed.fallbackId).toBe("me");
    }
  });

  it("persists and loads column band deltas per profile", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    const profileId = "test-profile-cols";
    const deltas: StatementProfileColumnBandDeltas = {
      txnDateDeltaLeft: 10,
      transactionDeltaRight: 25,
    };
    persistStatementProfileColumnBandDeltas(profileId, deltas);
    expect(profileHasSavedColumnBandDeltas(profileId)).toBe(true);
    expect(loadStatementProfileColumnBandDeltas(profileId)).toEqual(deltas);
  });
});
