import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditEvent } from "../src/models/AuditEvent.js";
import { RecoveryCase } from "../src/models/RecoveryCase.js";
import { Subscription } from "../src/models/Subscription.js";
import { decideRecoveryCase } from "../src/services/recovery/RecoveryDecisionService.js";
import { RECOVERY_ACTION_TYPES } from "../src/domain/types.js";

let memoryMongo: MongoMemoryServer;
beforeAll(async () => { memoryMongo = await MongoMemoryServer.create(); await mongoose.connect(memoryMongo.getUri()); }, 120_000);
beforeEach(async () => { await Promise.all([AuditEvent.deleteMany({}), RecoveryCase.deleteMany({}), Subscription.deleteMany({})]); });
afterAll(async () => { await mongoose.disconnect(); await memoryMongo.stop(); });

async function fixture(status: string = "DIAGNOSED", options: { scores?: boolean; stale?: boolean } = {}) {
  const subscription = await Subscription.create({ razorpaySubscriptionId: `sub_decide_${status}_${Date.now()}`, customer: { name: "Fixture", email: "fixture@example.test" }, plan: { name: "CloudDesk Pro", amountMinor: 69900, currency: "INR" }, status: "pending", razorpayCreatedAt: new Date("2026-08-20T00:00:00Z"), statistics: { successfulPayments: 2, failedPayments: 1, recoveredPayments: 0, consecutiveFailures: 1, nudgesSent: 0 } });
  const generatedAt = new Date("2026-08-28T10:00:00Z");
  const latestContext = { generatedAt, caseId: "fixture", subscription: { id: String(subscription._id), status: "pending", amountMinor: 69900, ageDays: 1, nativeRetryPossible: true }, failure: { category: "UNKNOWN", reason: null, source: null, step: null, paymentMethod: "card", failureCount: 1, consecutiveFailureCount: 1 }, customerHistory: { previousSuccessfulPayments: 2, previousFailedPayments: 1, previousRecoveredPayments: 0, previousRecoveryRate: 0, previousNudges: 0, hoursSinceLastNudge: null }, diagnosis: { classifierVersion: "classifier-v1", confidence: "LOW", explanation: "fixture" }, downtime: { checked: true, active: true, method: "card", severity: "high", matchLevel: "EXACT" }, caseState: { caseAgeHours: 1, revenueAtRiskMinor: 69900, previousActions: [] } };
  const scoreTime = options.stale ? new Date("2026-08-28T09:00:00Z") : new Date("2026-08-28T11:00:00Z");
  const latestScores = options.scores === false ? null : { scorerVersion: "logistic-v1", datasetVersion: "synthetic-recovery-v1", generatedAt: scoreTime, scores: RECOVERY_ACTION_TYPES.map((action, index) => ({ action, probability: [0.648596, 0.38905, 0.343801, 0.237914][index], expectedRecoveredMinor: [45337, 27195, 24025, 16630][index], scorerVersion: "logistic-v1", datasetVersion: "synthetic-recovery-v1", explanation: "fixture" })) };
  const recoveryCase = await RecoveryCase.create({ subscriptionId: subscription._id, razorpaySubscriptionId: subscription.razorpaySubscriptionId, status, openedAt: generatedAt, closedAt: ["RECOVERED", "STOPPED", "EXHAUSTED"].includes(status) ? new Date() : null, revenueAtRiskMinor: 69900, recoveredAmountMinor: 0, latestContext, latestScores });
  return { subscription, recoveryCase };
}

describe("RecoveryDecisionService", () => {
  it("transitions DIAGNOSED to DECIDED idempotently without execution side effects", async () => {
    const { subscription, recoveryCase } = await fixture(); const counters = subscription.statistics?.toObject();
    const first = await decideRecoveryCase(recoveryCase.id, new Date("2026-08-28T12:00:00Z"));
    const second = await decideRecoveryCase(recoveryCase.id, new Date("2026-08-28T13:00:00Z"));
    expect(first.decision).toMatchObject({ selectedAction: "WAIT_NATIVE_RETRY", reasonCode: "ACTIVE_PAYMENT_DOWNTIME", hardRuleApplied: true, scorerVersion: "logistic-v1" });
    expect(second.decision).toMatchObject({ selectedAction: first.decision.selectedAction, reasonCode: first.decision.reasonCode, decidedAt: first.decision.decidedAt });
    const stored = await RecoveryCase.findById(recoveryCase._id);
    expect(stored?.status).toBe("DECIDED"); expect(stored?.actions).toHaveLength(0); expect(stored?.decisions).toHaveLength(0);
    expect((await Subscription.findById(subscription._id))?.statistics?.toObject()).toEqual(counters);
    expect(await AuditEvent.countDocuments({ recoveryCaseId: recoveryCase._id, eventType: "POLICY_EVALUATED" })).toBe(1);
  });
  it("requires scores", async () => { const { recoveryCase } = await fixture("DIAGNOSED", { scores: false }); await expect(decideRecoveryCase(recoveryCase.id)).rejects.toMatchObject({ message: "Recovery scoring required before policy evaluation." }); });
  it("rejects stale scores", async () => { const { recoveryCase } = await fixture("DIAGNOSED", { stale: true }); await expect(decideRecoveryCase(recoveryCase.id)).rejects.toMatchObject({ message: "Recovery scores are stale. Rescore before policy evaluation." }); });
  it.each(["DETECTED", "RECOVERED", "STOPPED", "EXHAUSTED"])("rejects %s", async (status) => { const { recoveryCase } = await fixture(status); await expect(decideRecoveryCase(recoveryCase.id)).rejects.toMatchObject({ statusCode: 409 }); });
});
