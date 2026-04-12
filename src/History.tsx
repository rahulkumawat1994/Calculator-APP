import { useState } from "react";
import type { SavedSession, CalculationResult } from "./types";
import EditableBreakdown from "./EditableBreakdown";

interface Props {
  sessions: SavedSession[];
  onUpdate: (sessions: SavedSession[]) => void;
}

function toggle(key: string, set: Set<string>): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function mergeResults(session: SavedSession): CalculationResult {
  if (session.overrideResult) return session.overrideResult;
  return {
    results: session.messages.flatMap(m => m.result.results),
    total: session.messages.reduce((s, m) => s + m.result.total, 0),
  };
}

export default function History({ sessions, onUpdate }: Props) {
  const [openContacts, setOpenContacts] = useState<Set<string>>(new Set());
  const [openSessions, setOpenSessions] = useState<Set<string>>(new Set());

  if (!sessions.length) return null;

  const grandTotal = sessions.reduce((sum, s) => sum + mergeResults(s).total, 0);

  const contacts = [...new Set(sessions.map(s => s.contact))];

  const contactTotal = (contact: string) =>
    sessions
      .filter(s => s.contact === contact)
      .reduce((sum, s) => sum + mergeResults(s).total, 0);

  const handleResultChange = (sessionId: string, updated: CalculationResult) => {
    onUpdate(sessions.map(s => s.id === sessionId ? { ...s, overrideResult: updated } : s));
  };

  const deleteSession = (sessionId: string) =>
    onUpdate(sessions.filter(s => s.id !== sessionId));

  const deleteContact = (contact: string) =>
    onUpdate(sessions.filter(s => s.contact !== contact));

  return (
    <div className="w-full mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-xl font-bold text-[#1a1a1a]">📁 History</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            Grand Total:{" "}
            <span className="font-extrabold text-[#1d6fb8]">{grandTotal}</span>
          </span>
          <button
            onClick={() => onUpdate([])}
            className="text-xs text-red-500 hover:text-red-700 font-semibold border border-red-200 rounded-lg px-2.5 py-1 transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Contact accordion */}
      <div className="space-y-2">
        {contacts.map(contact => {
          const cSessions = sessions
            .filter(s => s.contact === contact)
            .sort((a, b) => b.createdAt - a.createdAt);
          const cTotal = contactTotal(contact);
          const isOpen = openContacts.has(contact);

          return (
            <div
              key={contact}
              className="bg-white rounded-[16px] shadow-sm border border-[#e8eef8] overflow-hidden"
            >
              {/* Contact row */}
              <div
                onClick={() => setOpenContacts(prev => toggle(contact, prev))}
                className="flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-[#f4f8ff] transition-colors select-none"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-[#1d6fb8] text-xs font-bold shrink-0">
                    {isOpen ? "▼" : "▶"}
                  </span>
                  <span className="font-bold text-[#1a1a1a] truncate">{contact}</span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {cSessions.length} day{cSessions.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="font-extrabold text-[#1d6fb8]">{cTotal}</span>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      deleteContact(contact);
                    }}
                    className="text-gray-300 hover:text-red-400 transition-colors p-1 text-base"
                    title="Delete all entries for this contact"
                  >
                    🗑
                  </button>
                </div>
              </div>

              {/* Date rows */}
              {isOpen && (
                <div className="border-t border-[#f0f4f8]">
                  {cSessions.map(session => {
                    const combined = mergeResults(session);
                    const isSessionOpen = openSessions.has(session.id);

                    return (
                      <div
                        key={session.id}
                        className="border-b border-[#f0f4f8] last:border-0"
                      >
                        {/* Date row */}
                        <div
                          onClick={() =>
                            setOpenSessions(prev => toggle(session.id, prev))
                          }
                          className="flex items-center justify-between px-5 py-3 bg-[#f8faff] cursor-pointer hover:bg-[#eef4ff] transition-colors select-none"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[#1d6fb8] text-[10px] font-bold shrink-0">
                              {isSessionOpen ? "▼" : "▶"}
                            </span>
                            <span className="text-sm font-semibold text-gray-700">
                              📅 {session.date}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold text-[#1d6fb8]">
                              {combined.total}
                            </span>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                deleteSession(session.id);
                              }}
                              className="text-gray-300 hover:text-red-400 transition-colors p-1 text-sm"
                              title="Delete this date"
                            >
                              🗑
                            </button>
                          </div>
                        </div>

                        {/* Breakdown */}
                        {isSessionOpen && (
                          <div className="px-4 py-3 bg-[#f8faff]">
                            <EditableBreakdown
                              compact
                              result={combined}
                              onChange={r => handleResultChange(session.id, r)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
