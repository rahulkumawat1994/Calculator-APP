/**
 * Calculator and app utilities — thin re-exports so callers keep `from "./calcUtils"`.
 * Implementation: `src/calc/`.
 */
export * from "./calc/betParser";
export { normalizeTypoTolerantInput, preprocessText } from "./calc/textNormalize";
export * from "./calc/pasteAndTotal";
export * from "./calc/market";
export * from "./calc/slotsTime";
export * from "./calc/sessions";
export * from "./calc/settingsPayments";
export * from "./calc/whatsapp";
export type { ParsedMessage } from "./types";
