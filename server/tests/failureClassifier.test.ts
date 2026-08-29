import { describe, expect, it } from "vitest";
import { failureClassifier } from "../src/services/classifier/FailureClassifier.js";

function classify(reason: string | null, source: string | null = null, step: string | null = null) {
  return failureClassifier.classify({ reason, source, step, code: null, paymentMethod: "card" });
}

describe("DeterministicFailureClassifier", () => {
  it.each([
    ["insufficient_funds", "TEMPORARY_FUNDS"],
    ["card_expired", "PAYMENT_METHOD_INVALID"],
    ["debit_instrument_inactive", "PAYMENT_METHOD_INVALID"],
    ["incorrect_otp", "CUSTOMER_AUTH_FAILURE"],
    ["incorrect_cvv", "CUSTOMER_AUTH_FAILURE"],
  ])("maps exact reason %s", (reason, category) => {
    const result = classify(reason);
    expect(result.category).toBe(category);
    expect(result.matchedBy).toBe("EXACT_REASON");
    expect(result.confidence).toBe("HIGH");
  });

  it("matches conservative mandate invalidation patterns", () => {
    expect(classify("mandate_revoked_by_bank")).toMatchObject({ category: "MANDATE_OR_AUTH_INVALID", confidence: "MEDIUM", matchedBy: "PATTERN_FALLBACK" });
    expect(classify("mandate_pending").category).toBe("UNKNOWN");
  });

  it.each(["bank", "gateway", "network"])("uses %s source fallback", (source) => {
    expect(classify("unmapped_reason", source)).toMatchObject({ category: "BANK_OR_NETWORK", matchedBy: "SOURCE_FALLBACK" });
  });

  it("keeps unknown and null evidence honest", () => {
    expect(classify("completely_unknown_reason")).toMatchObject({ category: "UNKNOWN", matchedBy: "UNKNOWN", confidence: "LOW" });
    expect(classify(null)).toMatchObject({ category: "UNKNOWN", matchedBy: "UNKNOWN" });
  });

  it("gives exact reason precedence and normalizes case", () => {
    expect(classify("  INSUFFICIENT-FUNDS ", "bank")).toMatchObject({ category: "TEMPORARY_FUNDS", matchedBy: "EXACT_REASON" });
  });
});
