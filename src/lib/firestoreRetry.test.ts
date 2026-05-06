import { describe, expect, it } from "vitest";
import { isRetryableFirestoreOrNetworkError } from "./firestoreRetry";

describe("isRetryableFirestoreOrNetworkError", () => {
  it("does not retry explicit CORS / access-control failures", () => {
    expect(
      isRetryableFirestoreOrNetworkError(
        new Error(
          "Access to fetch at 'https://firestore.googleapis.com/...' from origin 'http://localhost:5173' has been blocked by CORS policy",
        ),
      ),
    ).toBe(false);
  });

  it("still treats generic Failed to fetch as retryable (other callers)", () => {
    expect(isRetryableFirestoreOrNetworkError(new Error("Failed to fetch"))).toBe(true);
  });
});
