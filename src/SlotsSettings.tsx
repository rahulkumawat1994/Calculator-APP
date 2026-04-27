import { useState, useEffect } from "react";
import { Callout, Card } from "./ui";
import { formatSlotTime } from "@/lib";
import type { GameSlot, AppSettings } from "@/types";

interface Props {
  slots:          GameSlot[];
  settings:       AppSettings;
  onSaveSlots:    (s: GameSlot[]) => void;
  onSaveSettings: (s: AppSettings) => void;
}

const EMOJIS = ["🎮","🌍","⭐","🔥","💎","🎯","🏆","🌙","☀️","🎲"];

function generateId(): string {
  return `slot_${Date.now()}`;
}

export default function SlotsSettings({ slots, settings, onSaveSlots, onSaveSettings }: Props) {
  const [localSlots,    setLocalSlots]    = useState<GameSlot[]>(slots);
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  // Raw string for the % input so the user can backspace to empty before typing a new value
  const [pctRaw,        setPctRaw]        = useState<string>(String(settings.commissionPct));
  const [dirty,         setDirty]         = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Keep local state in sync when parent re-loads from Firebase (only if no unsaved changes)
  useEffect(() => {
    if (!dirty) {
      setLocalSlots(slots);
      setLocalSettings(settings);
      setPctRaw(String(settings.commissionPct));
    }
  }, [slots, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Slot helpers ──────────────────────────────────────────────────────────

  const updateSlot = (id: string, patch: Partial<GameSlot>) => {
    setLocalSlots(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    setDirty(true);
  };

  const toggleSlot = (id: string) => {
    const updated = localSlots.map(s =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    );
    setLocalSlots(updated);
    onSaveSlots(updated);   // save immediately for toggles
  };

  const addSlot = () => {
    const newSlot: GameSlot = {
      id:      generateId(),
      name:    "New Game",
      emoji:   "🎮",
      time:    "12:00",
      enabled: true,
    };
    const updated = [...localSlots, newSlot];
    setLocalSlots(updated);
    setDirty(true);
  };

  const deleteSlot = (id: string) => {
    const updated = localSlots.filter(s => s.id !== id);
    setLocalSlots(updated);
    onSaveSlots(updated);   // save immediately for deletes
    setDeleteConfirm(null);
    setDirty(false);
  };

  // ── Save / Reset ──────────────────────────────────────────────────────────

  const handleSave = () => {
    onSaveSlots(localSlots);
    onSaveSettings(localSettings);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setLocalSlots([]);
    setLocalSettings({ commissionPct: 5 });
    setPctRaw("5");
    setDirty(true);
  };

  return (
    <div className="w-full max-w-[540px] mx-auto">

      <div className="text-center mb-6">
        <div className="text-[36px] mb-1">⚙️</div>
        <h2 className="text-[24px] font-bold text-[#1a1a1a]">Settings</h2>
        <p className="text-[15px] text-gray-500 mt-1">Manage games, times, and your earnings %</p>
      </div>

      {/* ── Unsaved changes banner ── */}
      {dirty && (
        <Callout
          tone="amber"
          className="mb-4 flex items-center justify-between gap-3"
        >
          <span className="text-[14px] font-semibold">⚠️ You have unsaved changes</span>
          <button
            onClick={handleSave}
            className="shrink-0 rounded-[10px] bg-amber-500 px-3 py-1.5 text-[13px] font-bold text-white"
          >
            Save Now
          </button>
        </Callout>
      )}

      {/* ── My Earnings % ── */}
      <Card padding="md" className="mb-5">
        <h3 className="text-[18px] font-bold text-[#1a1a1a] mb-1">💰 My Earnings %</h3>
        <p className="text-[14px] text-gray-500 mb-4">
          How much percent you keep from each received payment.
        </p>
        <div className="flex items-center gap-4">
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={pctRaw}
            onChange={e => {
              const raw = e.target.value;
              setPctRaw(raw);
              const parsed = parseFloat(raw);
              if (!isNaN(parsed)) {
                setLocalSettings({ commissionPct: Math.min(100, Math.max(0, parsed)) });
              }
              setDirty(true);
            }}
            onBlur={() => {
              // If the field was left empty or invalid, snap back to the current valid value
              if (pctRaw.trim() === "" || isNaN(parseFloat(pctRaw))) {
                setPctRaw(String(localSettings.commissionPct));
              }
            }}
            className="w-28 text-center text-[28px] font-extrabold border-[3px] border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[14px] px-3 py-3 outline-none"
          />
          <span className="text-[28px] font-extrabold text-gray-400">%</span>
          <div className="text-[14px] text-gray-500 leading-snug">
            Example: ₹100 received<br />
            → You earn <span className="font-bold text-green-700">
              ₹{localSettings.commissionPct.toFixed(0)}
            </span>
          </div>
        </div>
      </Card>

      {/* ── Game slots ── */}
      <Card padding="md" className="mb-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[18px] font-bold text-[#1a1a1a]">🎮 Game Times</h3>
          <button
            onClick={addSlot}
            className="flex items-center gap-1.5 bg-[#eef5ff] text-[#1d6fb8] text-[13px] font-bold border-2 border-[#c5d8f0] rounded-[10px] px-3 py-1.5 active:opacity-75 transition-opacity"
          >
            + Add Game
          </button>
        </div>
        <p className="text-[14px] text-gray-500 mb-4">
          Edit name and result time. Toggle on/off. Add or remove games.
        </p>

        {localSlots.length === 0 ? (
          <p className="text-[14px] text-[#1d6fb8] font-semibold mb-4 rounded-[12px] border border-[#d5e6f7] bg-[#f4f8ff] px-3 py-2.5">
            No games yet — tap <strong>+ Add Game</strong> to create your first one, then <strong>Save Changes</strong>.
          </p>
        ) : null}

        <div className="space-y-4">
          {localSlots.map(slot => (
            <div
              key={slot.id}
              className={`rounded-[16px] border-2 p-4 transition-colors ${
                slot.enabled
                  ? "border-[#c5d8f0] bg-[#f5f9ff]"
                  : "border-gray-200 bg-gray-50 opacity-60"
              }`}
            >
              {/* Delete confirm */}
              {deleteConfirm === slot.id ? (
                <div className="text-center">
                  <p className="text-[14px] font-bold text-red-600 mb-3">
                    Delete <span className="italic">{slot.emoji} {slot.name}</span>? This cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteSlot(slot.id)}
                      className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-[12px] text-[14px]"
                    >
                      Yes, Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="flex-1 py-2.5 bg-gray-100 text-gray-600 font-semibold rounded-[12px] text-[14px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Top row: emoji + name + toggle + delete */}
                  <div className="flex items-center gap-2 mb-3">
                    {/* Emoji picker */}
                    <select
                      value={slot.emoji}
                      onChange={e => updateSlot(slot.id, { emoji: e.target.value })}
                      className="text-[22px] bg-transparent border-none outline-none cursor-pointer w-10 shrink-0"
                      title="Change emoji"
                    >
                      {EMOJIS.map(em => (
                        <option key={em} value={em}>{em}</option>
                      ))}
                    </select>

                    {/* Name input */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Game Name</div>
                      <input
                        type="text"
                        value={slot.name}
                        onChange={e => updateSlot(slot.id, { name: e.target.value })}
                        placeholder="Game name"
                        className="text-[19px] font-extrabold bg-transparent border-b-2 border-transparent focus:border-[#1d6fb8] outline-none text-[#1a1a1a] w-full transition-colors"
                      />
                    </div>

                    {/* Toggle */}
                    <button
                      onClick={() => toggleSlot(slot.id)}
                      className={`w-14 h-8 rounded-full relative overflow-hidden transition-colors shrink-0 ${
                        slot.enabled ? "bg-[#1d6fb8]" : "bg-gray-300"
                      }`}
                      title={slot.enabled ? "Tap to hide" : "Tap to show"}
                    >
                      <span
                        className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-200 ${
                          slot.enabled ? "translate-x-6" : "translate-x-0"
                        }`}
                      />
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => setDeleteConfirm(slot.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors p-1 shrink-0"
                      title="Delete this game"
                    >
                      🗑
                    </button>
                  </div>

                  {/* Time row */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
                        Result Time
                      </div>
                      <input
                        type="time"
                        value={slot.time}
                        onChange={e => updateSlot(slot.id, { time: e.target.value })}
                        className="text-[17px] font-bold border-2 border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[10px] px-3 py-2 outline-none bg-white"
                      />
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Shows as</div>
                      <div className="text-[17px] font-bold text-[#1d6fb8]">{formatSlotTime(slot.time)}</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Add Game button also at bottom if list is long */}
        <button
          onClick={addSlot}
          className="w-full mt-4 py-3.5 text-[15px] font-bold text-[#1d6fb8] bg-[#eef5ff] border-2 border-dashed border-[#c5d8f0] rounded-[14px] active:opacity-75 transition-opacity"
        >
          + Add New Game
        </button>
      </Card>

      {/* ── Buttons ── */}
      <div className="flex gap-3 mb-8">
        <button
          onClick={handleReset}
          className="flex-1 py-4 text-[16px] font-semibold text-gray-600 bg-white border-2 border-gray-200 rounded-[16px] active:opacity-80 transition-opacity"
        >
          Clear games list
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty && !saved}
          className={`flex-1 py-4 text-[16px] font-bold rounded-[16px] active:opacity-80 transition-all shadow-sm ${
            saved
              ? "bg-green-600 text-white"
              : dirty
              ? "bg-[#1d6fb8] text-white"
              : "bg-gray-100 text-gray-400 cursor-default"
          }`}
        >
          {saved ? "✅ Saved!" : "Save Changes"}
        </button>
      </div>

    </div>
  );
}
