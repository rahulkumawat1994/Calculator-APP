import { describe, expect, it } from "vitest";
import { guessCreditCardAccount } from "./moneyAccountTypes";

describe("guessCreditCardAccount", () => {
  it("detects common credit card account names", () => {
    expect(guessCreditCardAccount("Visa Credit Card")).toBe(true);
    expect(guessCreditCardAccount("HDFC Credit")).toBe(true);
    expect(guessCreditCardAccount("Amex Platinum")).toBe(true);
    expect(guessCreditCardAccount("Checking Account")).toBe(false);
    expect(guessCreditCardAccount("Savings")).toBe(false);
  });
});
