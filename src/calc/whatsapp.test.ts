import { describe, expect, it, vi } from "vitest";
import { parseWhatsAppMessages } from "./whatsapp";

describe("parseWhatsAppMessages date handling", () => {
  it("[8/4, 12:15 AM] on Aug 4 resolves to 04/08/2026 (not 07/04)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 10, 0, 0)); // 4 Aug 2026

    const raw = `[8/4, 12:15 am] Test User: 10 20 x5`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).toHaveLength(1);
    expect(msgs![0]!.date).toBe("04/08/2026");

    vi.useRealTimers();
  });

  it("date-first header keeps WhatsApp date for after-midnight messages", () => {
    const raw = `[29/05, 12:06 am] skgonline1979: 10 20 x5`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).toHaveLength(1);
    expect(msgs![0]!.date).toBe("29/05/2026");
  });

  it("unambiguous DD/MM date-first headers stay DD/MM", () => {
    const raw = `[04/06, 3:21 pm] User: 10 20 x5`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).toHaveLength(1);
    expect(msgs![0]!.date).toBe("04/06/2026");
  });

  it("time-first before-6am header still shifts to previous day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 10, 0, 0));

    const raw = `[2:30 am, 22/04/2026] User: 10 20 x5`;
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs).toHaveLength(1);
    expect(msgs![0]!.date).toBe("21/04/2026");

    vi.useRealTimers();
  });
});
