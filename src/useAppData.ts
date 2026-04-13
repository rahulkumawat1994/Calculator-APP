import { useState, useEffect } from "react";
import {
  DEFAULT_GAME_SLOTS, DEFAULT_SETTINGS,
  loadSessions,       saveSessions,
  loadGameSlots,      saveGameSlots,
  loadSettings,       saveSettings,
  loadPaymentRecords, savePaymentRecords,
} from "./calcUtils";
import {
  loadSessionsDB,  saveSessionsDB,
  loadSlotsDB,     saveSlotsDB,
  loadSettingsDB,  saveSettingsDB,
  loadPaymentsDB,  savePaymentsDB,
} from "./firestoreDb";
import type { SavedSession, GameSlot, AppSettings, PaymentRecord } from "./types";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

export function useAppData() {
  const [loading,  setLoading]  = useState(true);
  const [dbError,  setDbError]  = useState(false);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [slots,    setSlots]    = useState<GameSlot[]>(DEFAULT_GAME_SLOTS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);

  // Load from Firestore on startup with a 6s timeout.
  // Falls back to localStorage if Firestore is unreachable.
  useEffect(() => {
    const MIGRATED_KEY = "fb_migrated_v1";

    async function loadAll() {
      try {
        // One-time migration from localStorage → Firestore
        if (!localStorage.getItem(MIGRATED_KEY)) {
          const lsSessions = loadSessions();
          const lsPayments = loadPaymentRecords();
          const lsSlots    = loadGameSlots();
          const lsSet      = loadSettings();
          if (lsSessions.length) await saveSessionsDB(lsSessions);
          if (lsPayments.length) await savePaymentsDB(lsPayments);
          await saveSlotsDB(lsSlots);
          await saveSettingsDB(lsSet);
          localStorage.setItem(MIGRATED_KEY, "1");
        }

        const [s, sl, se, p] = await withTimeout(
          Promise.all([loadSessionsDB(), loadSlotsDB(), loadSettingsDB(), loadPaymentsDB()]),
          6000
        );
        setSessions(s);
        setSlots(sl);
        setSettings(se);
        setPayments(p);
      } catch (err) {
        console.warn("Firebase unavailable, using localStorage:", err);
        setSessions(loadSessions());
        setSlots(loadGameSlots());
        setSettings(loadSettings());
        setPayments(loadPaymentRecords());
        setDbError(true);
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, []);

  // Every save writes to both Firestore and localStorage as backup
  const handleSaveSessions = (u: SavedSession[])  => { setSessions(u); saveSessions(u); saveSessionsDB(u); };
  const handleSaveSlots    = (u: GameSlot[])       => { setSlots(u);    saveGameSlots(u); saveSlotsDB(u); };
  const handleSaveSettings = (u: AppSettings)      => { setSettings(u); saveSettings(u); saveSettingsDB(u); };
  const handleSavePayments = (u: PaymentRecord[])  => { setPayments(u); savePaymentRecords(u); savePaymentsDB(u); };

  return {
    loading,
    dbError,
    sessions,
    slots,
    settings,
    payments,
    handleSaveSessions,
    handleSaveSlots,
    handleSaveSettings,
    handleSavePayments,
  };
}
