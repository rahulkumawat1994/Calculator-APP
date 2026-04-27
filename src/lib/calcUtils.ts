/**
 * Calculator and app utilities — re-exports from `src/calc/`.
 * Call sites: `import { ... } from "@/lib/calcUtils"` (or `@/lib`).
 */
export * from "../calc/betParser";
export { normalizeTypoTolerantInput, preprocessText } from "../calc/textNormalize";
export * from "../calc/pasteAndTotal";
export * from "../calc/market";
export * from "../calc/slotsTime";
export * from "../calc/sessions";
export * from "../calc/settingsPayments";
export * from "../calc/whatsapp";
export type { ParsedMessage } from "../types";
