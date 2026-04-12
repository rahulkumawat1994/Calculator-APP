import { useState } from "react";
import type { SavedSession, CalculationResult } from "./types";

interface Props {
  sessions: SavedSession[];
  onUpdate: (sessions: SavedSession[]) => void;
}

function Breakdown({ result }: { result: CalculationResult }) {
  return (
    <div className="space-y-1.5 mt-2 mb-1">
      {result.results.map((r, i) => (
        <div
          key={i}
          className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-[#e8eef8]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-5 h-5 rounded-full bg-[#1d6fb8] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <span className="font-mono text-sm text-gray-700 truncate">{r.line}</span>
            {r.isWP && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
                WP
              </span>
            )}
            {r.isDouble && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-800 shrink-0">
                AB
              </span>
            )}
          </div>
          <span className="text-[#1d6fb8] font-bold text-sm ml-2 shrink-0">
            {r.count}×{r.rate}={r.lineTotal}
          </span>
        </div>
      ))}
      <div className="flex justify-between items-center px-3 py-2 bg-[#1d6fb8] rounded-xl mt-1">
        <span className="text-sm font-bold text-white">Total</span>
        <span className="text-base font-extrabold text-white">{result.total}</span>
      </div>
    </div>
  );
}

function toggle(key: string, set: Set<string>): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function mergeResults(session: SavedSession): CalculationResult {
  return {
    results: session.messages.flatMap(m => m.result.results),
    total: session.messages.reduce((s, m) => s + m.result.total, 0),
  };
}

export default function History({ sessions, onUpdate }: Props) {
  const [openContacts, setOpenContacts] = useState<Set<string>>(new Set());
  const [openSessions, setOpenSessions] = useState<Set<string>>(new Set());

  if (!sessions.length) return null;

  const grandTotal = sessions.reduce(
    (sum, s) => sum + s.messages.reduce((s2, m) => s2 + m.result.total, 0),
    0
  );

  const contacts = [...new Set(sessions.map(s => s.contact))];

  const contactTotal = (contact: string) =>
    sessions
      .filter(s => s.contact === contact)
      .reduce((sum, s) => sum + s.messages.reduce((s2, m) => s2 + m.result.total, 0), 0);

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
                            <Breakdown result={combined} />
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
