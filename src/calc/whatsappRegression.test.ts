import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWhatsAppMessages } from "./whatsapp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BULK_FIXTURE = join(__dirname, "__fixtures__", "whatsappRegressionBulk.txt");

/**
 * Large real-world WhatsApp export (multiple contacts, Hindi labels, promos, typos).
 * Regression: parser must stay stable; totals are the current correct implementation baseline.
 */
describe("WhatsApp bulk regression fixture", () => {
  it("parseWhatsAppMessages parses fixture and aggregates totals", () => {
    const raw = readFileSync(BULK_FIXTURE, "utf-8");
    const msgs = parseWhatsAppMessages(raw);
    expect(msgs, "fixture must be recognized as bracketed WhatsApp").not.toBeNull();

    const failed = msgs!.flatMap((m) => m.result.failedLines ?? []);
    const grandTotal = msgs!.reduce((s, m) => s + m.result.total, 0);

    expect(msgs!.length).toBe(156);
    expect(failed.length).toBe(0);
    expect(grandTotal).toMatchInlineSnapshot(`28181`);
  });
});
