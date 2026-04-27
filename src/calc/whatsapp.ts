import type { ParsedMessage } from "../types";
import { calculateTotal } from "./pasteAndTotal";

// ─── WhatsApp message parser ───────────────────────────────────────────────────

export function parseWhatsAppMessages(input: string): ParsedMessage[] | null {
  if (!/\[[^\]]*\]\s*[^:\n]+:/.test(input)) return null;

  const headerRegex = /\[([^\]]*)\]\s*([^:\n]+):\s*/g;
  const headers: Array<{ index: number; end: number; contact: string; date: string; timestamp: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(input)) !== null) {
    const content = match[1];
    const contact = match[2].trim();
    // Support both [6:16 pm, 12/4/2026], [14:26, 12/04/2026] and [12/04, 2:34 pm] formats
    const fullDateM  = content.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const shortDateM = content.match(/^(\d{1,2}\/\d{1,2})\s*,/);
    const year = new Date().getFullYear();
    const rawDate = fullDateM?.[1] ?? (shortDateM ? `${shortDateM[1]}/${year}` : '');
    // Normalize day and month to 2 digits so "12/4/2026" → "12/04/2026"
    const normalizedDate = rawDate
      ? rawDate.split('/').map((p, i) => (i < 2 ? p.padStart(2, '0') : p)).join('/')
      : '';
    const dateM = normalizedDate ? [null, normalizedDate] : null;
    const timeM = content.match(/(\d{1,2}:\d{2}(?:\s*[ap]m)?)/i);
    headers.push({
      index: match.index,
      end: match.index + match[0].length,
      contact,
      date: dateM?.[1] ?? '',
      timestamp: timeM?.[1] ?? content,
    });
  }

  if (!headers.length) return null;

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const textEnd = i + 1 < headers.length ? headers[i + 1].index : input.length;
    const text = input.slice(h.end, textEnd).trim();
    if (!text) continue;
    // Include index so messages at the same minute get unique IDs.
    // Pasting the same conversation twice will produce the same index → dedup still works.
    messages.push({
      id: `${h.contact}|${h.date}|${h.timestamp}|${i}`,
      contact: h.contact,
      date: h.date,
      timestamp: h.timestamp,
      text,
      result: calculateTotal(text),
    });
  }

  return messages.length ? messages : null;
}

/**
 * When a paste looks like WhatsApp and contains **more than one distinct contact**
 * (each with at least one non-empty message body), returns one combined snippet per
 * contact so the UI can open separate text areas. Otherwise `null` (keep one area).
 */
export function splitWhatsAppInputByContact(input: string): { contact: string; text: string }[] | null {
  if (!/\[[^\]]*\]\s*[^:\n]+:/.test(input)) return null;

  const headerRegex = /\[([^\]]*)\]\s*([^:\n]+):\s*/g;
  const headers: Array<{ index: number; end: number; contact: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(input)) !== null) {
    headers.push({
      index: match.index,
      end: match.index + match[0].length,
      contact: match[2].trim(),
    });
  }

  if (!headers.length) return null;

  const chunksByContact = new Map<string, string[]>();
  const order: string[] = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const textEnd = i + 1 < headers.length ? headers[i + 1].index : input.length;
    const body = input.slice(h.end, textEnd).trim();
    if (!body) continue;
    const block = input.slice(h.index, textEnd).trim();
    const key = h.contact;
    if (!chunksByContact.has(key)) {
      chunksByContact.set(key, []);
      order.push(key);
    }
    chunksByContact.get(key)!.push(block);
  }

  if (order.length <= 1) return null;

  return order.map(contact => ({
    contact,
    text: chunksByContact.get(contact)!.join("\n\n"),
  }));
}
