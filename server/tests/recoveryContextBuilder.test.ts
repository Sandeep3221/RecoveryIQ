import { describe, expect, it } from "vitest";
import { buildRecoveryContext, type RecoveryContextBuilderInput } from "../src/services/recovery/RecoveryContextBuilder.js";

function input(status: "pending" | "halted", failedPayments = 4): RecoveryContextBuilderInput {
  return {
    caseId: "case_fixture", openedAt: new Date("2026-08-27T12:00:00.000Z"), revenueAtRiskMinor: 69900,
    subscription: { id: "sub_fixture", status, amountMinor: 69900, razorpayCreatedAt: new Date("2026-08-18T12:00:00.000Z"), createdAt: new Date("2026-08-20T12:00:00.000Z"), successfulPayments: 3, failedPayments, recoveredPayments: 2, consecutiveFailures: 2, nudgesSent: 0, lastNudgeAt: null },
    failures: [{ id: "f1" }, { id: "f2" }, { id: "f2" }],
    latestFailure: { category: "BANK_OR_NETWORK", reason: null, source: "bank", step: null, paymentMethod: "card" },
    classification: { category: "BANK_OR_NETWORK", confidence: "MEDIUM", matchedBy: "SOURCE_FALLBACK", matchedRule: "error_source=bank", explanation: "Fixture explanation" },
    downtime: { checked: true, active: false, matched: false, matchLevel: "METHOD_ONLY", method: "card", severity: "medium", downtimeId: "down_fixture", checkedAt: new Date(), candidatesFound: 1, explanation: "Fixture downtime" },
    actions: [{ type: "SEND_NUDGE" }, { type: "invalid" }], now: new Date("2026-08-28T12:00:00.000Z"),
  };
}

describe("RecoveryContextBuilder", () => {
  it("builds pending retry, age, history, diagnosis, downtime, and actions", () => {
    const context = buildRecoveryContext(input("pending"));
    expect(context.subscription).toMatchObject({ nativeRetryPossible: true, ageDays: 10 });
    expect(context.failure).toMatchObject({ failureCount: 2, consecutiveFailureCount: 2 });
    expect(context.customerHistory).toMatchObject({ previousRecoveryRate: 0.5, hoursSinceLastNudge: null });
    expect(context.caseState).toMatchObject({ caseAgeHours: 24, revenueAtRiskMinor: 69900, previousActions: ["SEND_NUDGE"] });
    expect(context.diagnosis).toMatchObject({ classifierVersion: "classifier-v1", confidence: "MEDIUM" });
    expect(context.downtime).toMatchObject({ matchLevel: "METHOD_ONLY", active: false });
  });

  it("marks halted native retry unavailable and avoids division by zero", () => {
    const context = buildRecoveryContext(input("halted", 0));
    expect(context.subscription.nativeRetryPossible).toBe(false);
    expect(context.customerHistory.previousRecoveryRate).toBe(0);
  });
});
