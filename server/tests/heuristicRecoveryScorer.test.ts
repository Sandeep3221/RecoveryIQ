import { describe, expect, it } from "vitest";
import { BASE_RECOVERY_PROBABILITIES } from "../src/config/recoveryScoring.js";
import type { RecoveryContext } from "../src/domain/recovery/RecoveryContext.js";
import type { FailureCategory } from "../src/domain/types.js";
import { HeuristicRecoveryScorer } from "../src/services/scorer/HeuristicRecoveryScorer.js";

const scorer = new HeuristicRecoveryScorer();

function context(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  const base: RecoveryContext = {
    caseId: "case_fixture",
    subscription: { id: "sub_fixture", status: "active", amountMinor: 69900, ageDays: 10, nativeRetryPossible: true },
    failure: { category: "UNKNOWN", reason: null, source: null, step: null, paymentMethod: "card", failureCount: 1, consecutiveFailureCount: 1 },
    customerHistory: { previousSuccessfulPayments: 0, previousFailedPayments: 1, previousRecoveredPayments: 0, previousRecoveryRate: 0, previousNudges: 0, hoursSinceLastNudge: null },
    diagnosis: { classifierVersion: "classifier-v1", confidence: "HIGH", explanation: "Fixture" },
    downtime: { checked: true, active: false, method: "card", severity: null, matchLevel: "NONE" },
    caseState: { caseAgeHours: 1, revenueAtRiskMinor: 69900, previousActions: [] },
  };
  return {
    ...base,
    ...overrides,
    subscription: { ...base.subscription, ...overrides.subscription },
    failure: { ...base.failure, ...overrides.failure },
    customerHistory: { ...base.customerHistory, ...overrides.customerHistory },
    diagnosis: { ...base.diagnosis, ...overrides.diagnosis },
    downtime: { ...base.downtime, ...overrides.downtime },
    caseState: { ...base.caseState, ...overrides.caseState },
  };
}

function probability(scores: ReturnType<HeuristicRecoveryScorer["score"]>, action: string): number {
  return scores.find((score) => score.action === action)!.probability;
}

describe("heuristic-v1 configuration", () => {
  it.each([
    ["TEMPORARY_FUNDS", [0.60, 0.72, 0.15, 0.05]],
    ["PAYMENT_METHOD_INVALID", [0.10, 0.35, 0.82, 0.10]],
    ["BANK_OR_NETWORK", [0.75, 0.30, 0.10, 0.05]],
    ["CUSTOMER_AUTH_FAILURE", [0.30, 0.65, 0.25, 0.08]],
    ["MANDATE_OR_AUTH_INVALID", [0.05, 0.20, 0.35, 0.55]],
    ["UNKNOWN", [0.40, 0.35, 0.20, 0.15]],
  ] as const)("contains the documented %s base assumptions", (category, expected) => {
    expect(Object.values(BASE_RECOVERY_PROBABILITIES[category as FailureCategory])).toEqual(expected);
  });
});

describe("HeuristicRecoveryScorer", () => {
  it("applies native retry and downtime adjustments with explanations", () => {
    const scores = scorer.score(context({ downtime: { checked: true, active: true, method: "card", severity: "high", matchLevel: "EXACT" } }));
    expect(probability(scores, "WAIT_NATIVE_RETRY")).toBe(0.65);
    expect(probability(scores, "SEND_NUDGE")).toBe(0.25);
    expect(probability(scores, "REQUEST_CARD_UPDATE")).toBe(0.10);
    expect(scores[0]?.explanation).toContain("native retry remains available");
    expect(scores[0]?.explanation).toContain("downtime is active");
  });

  it("applies failure-count, history, nudge, halted, and low-confidence adjustments", () => {
    const scores = scorer.score(context({
      subscription: { id: "sub_fixture", status: "halted", amountMinor: 69900, ageDays: 10, nativeRetryPossible: false },
      failure: { category: "UNKNOWN", reason: null, source: null, step: null, paymentMethod: "card", failureCount: 3, consecutiveFailureCount: 3 },
      customerHistory: { previousSuccessfulPayments: 2, previousFailedPayments: 2, previousRecoveredPayments: 1, previousRecoveryRate: 0.5, previousNudges: 2, hoursSinceLastNudge: 1 },
      diagnosis: { classifierVersion: "classifier-v1", confidence: "LOW", explanation: "Fixture" },
    }));
    expect(probability(scores, "WAIT_NATIVE_RETRY")).toBe(0.01);
    expect(probability(scores, "SEND_NUDGE")).toBe(0.10);
    expect(probability(scores, "REQUEST_CARD_UPDATE")).toBe(0.25);
    expect(probability(scores, "STOP_AND_ESCALATE")).toBe(0.40);
  });

  it("calculates integer expected recovery, clamps, and repeats deterministically", () => {
    const fixture = context({ caseState: { caseAgeHours: 1, revenueAtRiskMinor: 69900, previousActions: [] } });
    const first = scorer.score(fixture);
    expect(first.find((score) => score.action === "WAIT_NATIVE_RETRY")?.expectedRecoveredMinor).toBe(34950);
    expect(first.every((score) => score.probability >= 0.01 && score.probability <= 0.99)).toBe(true);
    expect(scorer.score(fixture)).toEqual(first);
  });
});
