const LS_PROFILES_KEY = "statement-profiles-v1";
const LS_ACTIVE_PROFILE_KEY = "statement-active-profile-v1";
const LS_COLUMN_BANDS_PREFIX = "statement-profile-column-bands-v1";

export type StatementProfile = {
  id: string;
  name: string;
};

export const DEFAULT_STATEMENT_PROFILE_ID = "me";

const DEFAULT_PROFILES: StatementProfile[] = [{ id: "me", name: "Me" }];

function slugifyProfileId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "profile";
}

function newProfileId(name: string, existing: StatementProfile[]): string {
  const base = slugifyProfileId(name);
  if (!existing.some((p) => p.id === base)) return base;
  let n = 2;
  while (existing.some((p) => p.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function loadStatementProfiles(): StatementProfile[] {
  if (typeof window === "undefined") return [...DEFAULT_PROFILES];
  try {
    const raw = localStorage.getItem(LS_PROFILES_KEY);
    if (!raw) return [...DEFAULT_PROFILES];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [...DEFAULT_PROFILES];
    const out: StatementProfile[] = [];
    for (const x of data) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.name === "string" && o.id.length > 0) {
        out.push({ id: o.id, name: o.name.trim() || o.id });
      }
    }
    if (!out.some((p) => p.id === DEFAULT_STATEMENT_PROFILE_ID)) {
      out.unshift({ id: DEFAULT_STATEMENT_PROFILE_ID, name: "Me" });
    }
    return out;
  } catch {
    return [...DEFAULT_PROFILES];
  }
}

export function persistStatementProfiles(profiles: StatementProfile[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    /* quota */
  }
}

export function loadActiveStatementProfileId(): string {
  if (typeof window === "undefined") return DEFAULT_STATEMENT_PROFILE_ID;
  try {
    const raw = localStorage.getItem(LS_ACTIVE_PROFILE_KEY);
    if (raw && raw.trim().length > 0) return raw.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_STATEMENT_PROFILE_ID;
}

export function persistActiveStatementProfileId(profileId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_ACTIVE_PROFILE_KEY, profileId);
  } catch {
    /* quota */
  }
}

/** Pick `preferredId` when it exists; otherwise default to `me` or first profile. */
export function resolveActiveStatementProfileId(
  profiles: StatementProfile[],
  preferredId?: string,
): string {
  if (profiles.length === 0) return DEFAULT_STATEMENT_PROFILE_ID;
  const ids = new Set(profiles.map((p) => p.id));
  const pref = preferredId?.trim();
  if (pref && ids.has(pref)) return pref;
  if (ids.has(DEFAULT_STATEMENT_PROFILE_ID)) return DEFAULT_STATEMENT_PROFILE_ID;
  return profiles[0]!.id;
}

export type StatementProfileFilters = {
  transactionSearchRaw: string;
  txnDateFrom: string;
  txnDateTo: string;
  showOnlyPageTotals: boolean;
  showPdfPrintedTotals: boolean;
};

const LS_FILTERS_PREFIX = "statement-profile-filters-v1";

export function loadStatementProfileFilters(profileId: string): StatementProfileFilters {
  if (typeof window === "undefined") {
    return { transactionSearchRaw: "", txnDateFrom: "", txnDateTo: "", showOnlyPageTotals: false, showPdfPrintedTotals: false };
  }
  try {
    const raw = localStorage.getItem(`${LS_FILTERS_PREFIX}:${profileId}`);
    if (!raw) return { transactionSearchRaw: "", txnDateFrom: "", txnDateTo: "", showOnlyPageTotals: false, showPdfPrintedTotals: false };
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      transactionSearchRaw:
        typeof data.transactionSearchRaw === "string" ? data.transactionSearchRaw : "",
      txnDateFrom: typeof data.txnDateFrom === "string" ? data.txnDateFrom : "",
      txnDateTo: typeof data.txnDateTo === "string" ? data.txnDateTo : "",
      showOnlyPageTotals: data.showOnlyPageTotals === true,
      showPdfPrintedTotals: data.showPdfPrintedTotals === true,
    };
  } catch {
    return { transactionSearchRaw: "", txnDateFrom: "", txnDateTo: "", showOnlyPageTotals: false, showPdfPrintedTotals: false };
  }
}

export function persistStatementProfileFilters(
  profileId: string,
  filters: StatementProfileFilters,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${LS_FILTERS_PREFIX}:${profileId}`, JSON.stringify(filters));
  } catch {
    /* quota */
  }
}

/** Per-profile column guide deltas (partial JSON merged with defaults on load). */
export type StatementProfileColumnBandDeltas = {
  txnDateDeltaLeft?: number;
  txnDateDeltaRight?: number;
  transactionDeltaLeft?: number;
  transactionDeltaRight?: number;
  withdrawalDeltaLeft?: number;
  withdrawalDeltaRight?: number;
  depositDeltaLeft?: number;
  depositDeltaRight?: number;
};

export function loadStatementProfileColumnBandDeltas(
  profileId: string,
): StatementProfileColumnBandDeltas | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${LS_COLUMN_BANDS_PREFIX}:${profileId}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: StatementProfileColumnBandDeltas = {};
    const keys: (keyof StatementProfileColumnBandDeltas)[] = [
      "txnDateDeltaLeft",
      "txnDateDeltaRight",
      "transactionDeltaLeft",
      "transactionDeltaRight",
      "withdrawalDeltaLeft",
      "withdrawalDeltaRight",
      "depositDeltaLeft",
      "depositDeltaRight",
    ];
    for (const key of keys) {
      const v = data[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function persistStatementProfileColumnBandDeltas(
  profileId: string,
  deltas: StatementProfileColumnBandDeltas,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${LS_COLUMN_BANDS_PREFIX}:${profileId}`, JSON.stringify(deltas));
  } catch {
    /* quota */
  }
}

export function profileHasSavedColumnBandDeltas(profileId: string): boolean {
  return loadStatementProfileColumnBandDeltas(profileId) != null;
}

export function addStatementProfile(
  profiles: StatementProfile[],
  name: string,
): { profiles: StatementProfile[]; newId: string } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name for this profile." };
  const id = newProfileId(trimmed, profiles);
  const next = [...profiles, { id, name: trimmed }];
  persistStatementProfiles(next);
  return { profiles: next, newId: id };
}

export function clearStatementProfileLocalData(profileId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${LS_FILTERS_PREFIX}:${profileId}`);
    localStorage.removeItem(`statement-saved-txn-searches-v1:${profileId}`);
    localStorage.removeItem(`${LS_COLUMN_BANDS_PREFIX}:${profileId}`);
    localStorage.removeItem(`statement-profile-commission-config-v1:${profileId}`);
    localStorage.removeItem(`statement-profile-commission-overrides-v1:${profileId}`);
  } catch {
    /* ignore */
  }
}

export function renameStatementProfile(
  profiles: StatementProfile[],
  profileId: string,
  name: string,
): { profiles: StatementProfile[] } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name for this profile." };
  if (!profiles.some((p) => p.id === profileId)) return { error: "Profile not found." };
  const next = profiles.map((p) => (p.id === profileId ? { ...p, name: trimmed } : p));
  persistStatementProfiles(next);
  return { profiles: next };
}

export function removeStatementProfile(
  profiles: StatementProfile[],
  profileId: string,
): { profiles: StatementProfile[]; fallbackId: string } | { error: string } {
  if (profiles.length <= 1) return { error: "Keep at least one profile." };
  if (!profiles.some((p) => p.id === profileId)) return { error: "Profile not found." };
  const next = profiles.filter((p) => p.id !== profileId);
  clearStatementProfileLocalData(profileId);
  persistStatementProfiles(next);
  return { profiles: next, fallbackId: next[0]!.id };
}
