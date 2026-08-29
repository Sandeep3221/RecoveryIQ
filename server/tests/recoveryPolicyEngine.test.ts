import { describe, expect, it } from "vitest";
import { recoveryPolicy } from "../src/config/recoveryPolicy.js";
import type { RecoveryContext } from "../src/domain/recovery/RecoveryContext.js";
import { RECOVERY_ACTION_TYPES, type RecoveryActionType } from "../src/domain/types.js";
import { evaluateRecoveryPolicy } from "../src/services/policy/RecoveryPolicyEngine.js";
import type { RecoveryScore } from "../src/services/scorer/RecoveryScorer.js";

function context(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  const base: RecoveryContext = {
    generatedAt: new Date("2026-08-28T10:00:00Z"), caseId: "case-policy",
    subscription: { id: "sub-policy", status: "pending", amountMinor: 69900, ageDays: 1, nativeRetryPossible: true },
    failure: { category: "BANK_OR_NETWORK", reason: null, source: "bank", step: null, paymentMethod: "card", failureCount: 1, consecutiveFailureCount: 1 },
    customerHistory: { previousSuccessfulPayments: 1, previousFailedPayments: 1, previousRecoveredPayments: 0, previousRecoveryRate: 0, previousNudges: 0, hoursSinceLastNudge: null },
    diagnosis: { classifierVersion: "classifier-v1", confidence: "MEDIUM", explanation: "fixture" },
    downtime: { checked: true, active: false, method: "card", severity: null, matchLevel: "NONE" },
    caseState: { caseAgeHours: 1, revenueAtRiskMinor: 69900, previousActions: [] },
  };
  return { ...base, ...overrides };
}
function scores(version = "heuristic-v1", values: Partial<Record<RecoveryActionType, number>> = {}): RecoveryScore[] {
  return RECOVERY_ACTION_TYPES.map((action) => ({ action, probability: values[action] ?? 0.4, expectedRecoveredMinor: Math.round((values[action] ?? 0.4) * 69900), scorerVersion: version, explanation: "fixture" }));
}
function decide(value: RecoveryContext, scoreSet = scores()) { return evaluateRecoveryPolicy({ context: value, scores: scoreSet, policyConfig: recoveryPolicy, decidedAt: new Date("2026-08-28T12:00:00Z") }); }

describe("RecoveryPolicyEngine hard-rule precedence", () => {
  it.each([
    ["terminal subscription", context({ subscription: { ...context().subscription, status: "cancelled" } }), "STOP_AND_ESCALATE", "SUBSCRIPTION_TERMINAL"],
    ["old case", context({ caseState: { ...context().caseState, caseAgeHours: 168 } }), "STOP_AND_ESCALATE", "CASE_TOO_OLD"],
    ["invalid mandate", context({ failure: { ...context().failure, category: "MANDATE_OR_AUTH_INVALID" } }), "STOP_AND_ESCALATE", "MANDATE_INVALID"],
    ["invalid card", context({ failure: { ...context().failure, category: "PAYMENT_METHOD_INVALID" } }), "REQUEST_CARD_UPDATE", "PAYMENT_METHOD_REQUIRES_UPDATE"],
    ["active downtime pending", context({ downtime: { checked: true, active: true, method: "card", severity: "high", matchLevel: "EXACT" } }), "WAIT_NATIVE_RETRY", "ACTIVE_PAYMENT_DOWNTIME"],
    ["active downtime halted", context({ subscription: { ...context().subscription, status: "halted", nativeRetryPossible: false }, downtime: { checked: true, active: true, method: "card", severity: "high", matchLevel: "EXACT" } }), "STOP_AND_ESCALATE", "NATIVE_RETRIES_EXHAUSTED"],
    ["repeated unknown", context({ failure: { ...context().failure, category: "UNKNOWN", consecutiveFailureCount: 2 } }), "STOP_AND_ESCALATE", "REPEATED_UNKNOWN_FAILURE"],
    ["first unknown", context({ failure: { ...context().failure, category: "UNKNOWN", consecutiveFailureCount: 1 } }), "WAIT_NATIVE_RETRY", "NATIVE_RETRY_AVAILABLE"],
  ])("applies %s", (_name, value, action, reason) => expect(decide(value as RecoveryContext)).toMatchObject({ selectedAction: action, reasonCode: reason, hardRuleApplied: true }));

  it("always blocks WAIT on a halted subscription", () => {
    const result = decide(context({ subscription: { ...context().subscription, status: "halted", nativeRetryPossible: false } }));
    expect(result.blockedActions).toContainEqual(expect.objectContaining({ action: "WAIT_NATIVE_RETRY", reasonCode: "NATIVE_RETRIES_EXHAUSTED" }));
  });
});

describe("RecoveryPolicyEngine nudge guards and scorer-independent ranking", () => {
  it.each([[2, null, "NUDGE_LIMIT_REACHED"], [3, null, "NUDGE_LIMIT_REACHED"], [0, 10, "NUDGE_COOLDOWN_ACTIVE"]] as const)("blocks nudge at count %s and hours %s", (previousNudges, hoursSinceLastNudge, reasonCode) => {
    const result = decide(context({ customerHistory: { ...context().customerHistory, previousNudges, hoursSinceLastNudge } }), scores("heuristic-v1", { SEND_NUDGE: 0.99, WAIT_NATIVE_RETRY: 0.8, STOP_AND_ESCALATE: 0.1 }));
    expect(result.selectedAction).toBe("WAIT_NATIVE_RETRY");
    expect(result.blockedActions).toContainEqual(expect.objectContaining({ action: "SEND_NUDGE", reasonCode }));
  });
  it.each([24, null])("allows nudge when cooldown is %s", (hoursSinceLastNudge) => {
    const result = decide(context({ customerHistory: { ...context().customerHistory, hoursSinceLastNudge } }), scores("heuristic-v1", { SEND_NUDGE: 0.9 }));
    expect(result.allowedActions).toContain("SEND_NUDGE");
  });
  it.each(["heuristic-v1", "logistic-v1"])("ranks only allowed actions for %s", (version) => {
    const value = context({ customerHistory: { ...context().customerHistory, previousNudges: 2 } });
    const result = decide(value, scores(version, { SEND_NUDGE: 0.99, WAIT_NATIVE_RETRY: 0.75, STOP_AND_ESCALATE: 0.2 }));
    expect(result).toMatchObject({ scorerVersion: version, selectedAction: "WAIT_NATIVE_RETRY", hardRuleApplied: false });
  });
});
