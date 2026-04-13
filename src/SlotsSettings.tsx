import { useState } from "react";
import { DEFAULT_GAME_SLOTS, formatSlotTime } from "./calcUtils";
import type { GameSlot, AppSettings } from "./types";

interface Props {
  slots:          GameSlot[];
  settings:       AppSettings;
  onSaveSlots:    (s: GameSlot[]) => void;
  onSaveSettings: (s: AppSettings) => void;
}

export default function SlotsSettings({ slots, settings, onSaveSlots, onSaveSettings }: Props) {
  const [localSlots,    setLocalSlots]    = useState<GameSlot[]>(slots);
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [saved,         setSaved]         = useState(false);

  const updateSlot = (id: string, patch: Partial<GameSlot>) =>
    setLocalSlots(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  const handleSave = () => {
    onSaveSlots(localSlots);
    onSaveSettings(localSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setLocalSlots(DEFAULT_GAME_SLOTS);
    setLocalSettings({ commissionPct: 5 });
  };

  return (
    <div className="w-full max-w-[540px] mx-auto">

      <div className="text-center mb-6">
        <div className="text-[36px] mb-1">⚙️</div>
        <h2 className="text-[24px] font-bold text-[#1a1a1a]">Settings</h2>
        <p className="text-[15px] text-gray-500 mt-1">Change game names, times, and your earnings %</p>
      </div>

      {/* ── My Earnings % ── */}
      <div className="bg-white rounded-[20px] shadow-sm border-2 border-[#e4edf8] p-5 mb-5">
        <h3 className="text-[18px] font-bold text-[#1a1a1a] mb-1">💰 My Earnings %</h3>
        <p className="text-[14px] text-gray-500 mb-4">
          How much percent you keep from money received in each game.
        </p>
        <div className="flex items-center gap-4">
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={localSettings.commissionPct}
            onChange={e => setLocalSettings({ commissionPct: parseFloat(e.target.value) || 0 })}
            className="w-28 text-center text-[28px] font-extrabold border-[3px] border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[14px] px-3 py-3 outline-none"
          />
          <span className="text-[28px] font-extrabold text-gray-400">%</span>
          <div className="text-[14px] text-gray-500 leading-snug">
            Example: ₹100 received<br />
            → You earn <span className="font-bold text-green-700">
              ₹{((localSettings.commissionPct || 0)).toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Game slots ── */}
      <div className="bg-white rounded-[20px] shadow-sm border-2 border-[#e4edf8] p-5 mb-5">
        <h3 className="text-[18px] font-bold text-[#1a1a1a] mb-1">🎮 Game Times</h3>
        <p className="text-[14px] text-gray-500 mb-4">
          Change the name or result time for each game. Tap the toggle to show/hide a game.
        </p>

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
              {/* Top row: emoji + toggle */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={slot.emoji}
                    onChange={e => updateSlot(slot.id, { emoji: e.target.value })}
                    className="w-12 text-center text-[26px] bg-transparent border-none outline-none"
                    maxLength={4}
                  />
                  <div>
                    <div className="text-[12px] text-gray-400 font-semibold uppercase tracking-wide">Game Name</div>
                    <input
                      type="text"
                      value={slot.name}
                      onChange={e => updateSlot(slot.id, { name: e.target.value })}
                      placeholder="Name"
                      className="text-[19px] font-extrabold bg-transparent border-none outline-none text-[#1a1a1a] w-36"
                    />
                  </div>
                </div>

                {/* ON/OFF toggle */}
                <button
                  onClick={() => updateSlot(slot.id, { enabled: !slot.enabled })}
                  className={`w-14 h-8 rounded-full relative transition-colors shrink-0 ${
                    slot.enabled ? "bg-[#1d6fb8]" : "bg-gray-300"
                  }`}
                  title={slot.enabled ? "Tap to hide this game" : "Tap to show this game"}
                >
                  <span
                    className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                      slot.enabled ? "translate-x-7" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Time row */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-[12px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
                    Result Time
                  </div>
                  <input
                    type="time"
                    value={slot.time}
                    onChange={e => updateSlot(slot.id, { time: e.target.value })}
                    className="text-[17px] font-bold border-2 border-[#c5cfe0] focus:border-[#1d6fb8] rounded-[10px] px-3 py-2 outline-none bg-white"
                  />
                </div>
                <div className="text-right">
                  <div className="text-[12px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Shows as</div>
                  <div className="text-[17px] font-bold text-[#1d6fb8]">{formatSlotTime(slot.time)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Buttons ── */}
      <div className="flex gap-3 mb-4">
        <button
          onClick={handleReset}
          className="flex-1 py-4 text-[16px] font-semibold text-gray-600 bg-white border-2 border-gray-200 rounded-[16px] active:opacity-80 transition-opacity"
        >
          Reset to Default
        </button>
        <button
          onClick={handleSave}
          className={`flex-1 py-4 text-[16px] font-bold rounded-[16px] active:opacity-80 transition-all shadow-sm ${
            saved
              ? "bg-green-600 text-white"
              : "bg-[#1d6fb8] text-white"
          }`}
        >
          {saved ? "✅ Saved!" : "Save Changes"}
        </button>
      </div>

    </div>
  );
}
