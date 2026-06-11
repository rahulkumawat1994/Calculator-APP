const CREDIT_CARD_KEY = "money-view-credit-cards-v1";

const AUTO_DETECT_PATTERNS = [
  /\bcredit\s*card\b/i,
  /\bcredit\b/i,
  /\bcard\b/i,
  /\bcc\b/i,
  /\bvisa\b/i,
  /\bmastercard\b/i,
  /\bamex\b/i,
  /\bamerican express\b/i,
  /\bdiscover\b/i,
  /\brupay\b/i,
  /\bplatinum\b/i,
];

export function guessCreditCardAccount(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return AUTO_DETECT_PATTERNS.some((re) => re.test(n));
}

export function loadCreditCardAccounts(): Set<string> {
  try {
    const raw = localStorage.getItem(CREDIT_CARD_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.filter(Boolean));
  } catch {
    return new Set();
  }
}

export function saveCreditCardAccounts(accounts: Set<string>): void {
  try {
    localStorage.setItem(CREDIT_CARD_KEY, JSON.stringify([...accounts].sort()));
  } catch {
    /* ignore */
  }
}

/** Merge saved credit-card flags with auto-detected names from a new upload. */
export function mergeCreditCardAccounts(accountNames: string[]): Set<string> {
  const merged = loadCreditCardAccounts();
  for (const name of accountNames) {
    if (guessCreditCardAccount(name)) merged.add(name);
  }
  saveCreditCardAccounts(merged);
  return merged;
}

export function isCreditCardAccount(
  account: string,
  creditCardAccounts: ReadonlySet<string>,
): boolean {
  return creditCardAccounts.has(account.trim());
}
