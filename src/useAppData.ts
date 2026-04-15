import { useState, useEffect } from "react";
import {
  DEFAULT_GAME_SLOTS, DEFAULT_SETTINGS,
  loadGameSlots, saveGameSlots,
  loadSettings,  saveSettings,
} from "./calcUtils";
import {
  loadSlotsDB,    saveSlotsDB,
  loadSettingsDB, saveSettingsDB,
  saveSessionDoc, deleteSessionDoc,
  loadSessionsByDate, loadSessionsByMonth, loadSessionDatesForMonth,
  savePaymentDoc, deletePaymentDoc, deletePaymentsByContactDate,
  loadPaymentsByDate, loadPaymentsByMonth,
  migrateOldFirestoreData,
  logCalculationAudit,
} from "./firestoreDb";
import type { GameSlot, AppSettings } from "./types";
import { toastApiError } from "./apiToast";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

export function useAppData() {
  const [loading,    setLoading]    = useState(true);
  const [dbError,    setDbError]    = useState(false);
  const [writeError, setWriteError] = useState(false);
  const [slots,      setSlots]      = useState<GameSlot[]>(DEFAULT_GAME_SLOTS);
  const [settings,   setSettings]   = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const LS_MIGRATED     = "fb_migrated_v1";
    const DB_MIGRATED_KEY = "fb_db_migrated_v2"; // per-doc migration flag

    async function loadAll() {
      try {
        // ── One-time localStorage → Firestore migration ──────────────────────
        if (!localStorage.getItem(LS_MIGRATED)) {
          const lsSlots = loadGameSlots();
          const lsSet   = loadSettings();
          await saveSlotsDB(lsSlots);
          await saveSettingsDB(lsSet);
          localStorage.setItem(LS_MIGRATED, "1");
        }

        // ── One-time bulk-doc → per-doc Firestore migration ──────────────────
        if (!localStorage.getItem(DB_MIGRATED_KEY)) {
          await migrateOldFirestoreData();
          localStorage.setItem(DB_MIGRATED_KEY, "1");
        }

        // ── Load slots + settings (small, always needed upfront) ─────────────
        const [sl, se] = await withTimeout(
          Promise.all([loadSlotsDB(), loadSettingsDB()]),
          6000
        );
        setSlots(sl);
        setSettings(se);
      } catch (err) {
        console.warn("Firebase unavailable, using localStorage:", err);
        toastApiError(err, "Could not connect to the database. Using offline data.");
        setSlots(loadGameSlots());
        setSettings(loadSettings());
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, []);

  // ── Slots & Settings save (dual-write: Firestore + localStorage backup) ──────
  const handleSaveSlots = async (u: GameSlot[]) => {
    setSlots(u);
    saveGameSlots(u);
    try {
      await saveSlotsDB(u);
      setWriteError(false);
    } catch (err) {
      toastApiError(err, "Could not save game list to the database.");
      setWriteError(true);
    }
  };

  const handleSaveSettings = async (u: AppSettings) => {
    setSettings(u);
    saveSettings(u);
    try {
      await saveSettingsDB(u);
      setWriteError(false);
    } catch (err) {
      toastApiError(err, "Could not save settings to the database.");
      setWriteError(true);
    }
  };

  return {
    loading, dbError, writeError,
    slots, settings,
    handleSaveSlots, handleSaveSettings,

    // ── Firestore functions passed to components for lazy loading ────────────
    saveSessionDoc,    deleteSessionDoc,
    loadSessionsByDate, loadSessionsByMonth, loadSessionDatesForMonth,
    savePaymentDoc,    deletePaymentDoc, deletePaymentsByContactDate,
    loadPaymentsByDate, loadPaymentsByMonth,
    logCalculationAudit,
  };
}
