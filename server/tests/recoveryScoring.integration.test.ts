import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RecoveryContext } from "../src/domain/recovery/RecoveryContext.js";
import { AuditEvent } from "../src/models/AuditEvent.js";
import { RecoveryCase } from "../src/models/RecoveryCase.js";
import { Subscription } from "../src/models/Subscription.js";
import { scoreRecoveryCase } from "../src/services/recovery/RecoveryScoringService.js";
import { LogisticRecoveryScorer } from "../src/services/scorer/LogisticRecoveryScorer.js";
import { heuristicRecoveryScorer } from "../src/services/scorer/HeuristicRecoveryScorer.js";
import { resolve } from "node:path";

let memoryMongo: MongoMemoryServer;

const latestContext: RecoveryContext = {
  caseId: "placeholder",
  subscription: { id: "placeholder", status: "pending", amountMinor: 69900, ageDays: 1, nativeRetryPossible: true },
  failure: { category: "UNKNOWN", reason: null, source: null, step: null, paymentMethod: "card", failureCount: 1, consecutiveFailureCount: 1 },
  customerHistory: { previousSuccessfulPayments: 0, previousFailedPayments: 1, previousRecoveredPayments: 0, previousRecoveryRate: 0, previousNudges: 0, hoursSinceLastNudge: null },
  diagnosis: { classifierVersion: "classifier-v1", confidence: "LOW", explanation: "Sparse fixture" },
  downtime: { checked: true, active: true, method: "card", severity: "high", matchLevel: "EXACT" },
  caseState: { caseAgeHours: 1, revenueAtRiskMinor: 69900, previousActions: [] },
};

beforeAll(async () => {
  memoryMongo = await MongoMemoryServer.create();
  await mongoose.connect(memoryMongo.getUri());
  await Promise.all([Subscription.syncIndexes(), RecoveryCase.syncIndexes(), AuditEvent.syncIndexes()]);
}, 120_000);

beforeEach(async () => { await Promise.all([Subscription.deleteMany({}), RecoveryCase.deleteMany({}), AuditEvent.deleteMany({})]); });
afterAll(async () => { await mongoose.disconnect(); await memoryMongo.stop(); });

async function fixture(status: "DETECTED" | "DIAGNOSED" | "RECOVERED" | "STOPPED") {
  const subscription = await Subscription.create({ razorpaySubscriptionId: `sub_score_${status}`, customer: { name: "Fixture", email: "fixture@example.test" }, plan: { name: "CloudDesk Pro", amountMinor: 69900, currency: "INR" }, status: "pending", statistics: { successfulPayments: 2, failedPayments: 1, recoveredPayments: 0, consecutiveFailures: 1, nudgesSent: 0 }, razorpayCreatedAt: new Date("2026-08-20T00:00:00.000Z") });
  const recoveryCase = await RecoveryCase.create({ subscriptionId: subscription._id, razorpaySubscriptionId: subscription.razorpaySubscriptionId, status, openedAt: new Date(), closedAt: status === "RECOVERED" || status === "STOPPED" ? new Date() : null, revenueAtRiskMinor: 69900, recoveredAmountMinor: 0, latestContext: status === "DETECTED" ? null : latestContext });
  return { subscription, recoveryCase };
}

describe("RecoveryScoringService", () => {
  it("scores DIAGNOSED cases idempotently without actions or counter changes", async () => {
    const { subscription, recoveryCase } = await fixture("DIAGNOSED");
    const before = subscription.statistics?.toObject();
    const first = await scoreRecoveryCase(recoveryCase.id, new Date("2026-08-28T12:00:00.000Z"), heuristicRecoveryScorer);
    const second = await scoreRecoveryCase(recoveryCase.id, new Date("2026-08-28T12:05:00.000Z"), heuristicRecoveryScorer);
    expect(first.scorerVersion).toBe("heuristic-v1");
    expect(first.scores).toHaveLength(4);
    expect(second.scores).toEqual(first.scores);
    const stored = await RecoveryCase.findById(recoveryCase._id);
    expect(stored?.status).toBe("DIAGNOSED");
    expect(stored?.latestScores?.scores).toHaveLength(4);
    expect(stored?.actions).toHaveLength(0);
    expect(stored?.decisions).toHaveLength(0);
    expect((await Subscription.findById(subscription._id))?.statistics?.toObject()).toEqual(before);
    expect(await AuditEvent.countDocuments({ recoveryCaseId: recoveryCase._id, eventType: "RECOVERY_SCORED" })).toBe(1);
  });

  it("persists logistic-v1 without creating decisions, actions, or counter changes", async () => {
    const { subscription, recoveryCase } = await fixture("DIAGNOSED");
    const before = subscription.statistics?.toObject();
    const result = await scoreRecoveryCase(recoveryCase.id, new Date("2026-08-28T12:00:00.000Z"), new LogisticRecoveryScorer(resolve("src/services/scorer/models/logistic_recovery_v1.json")));
    expect(result).toMatchObject({ scorerVersion: "logistic-v1", datasetVersion: "synthetic-recovery-v1" });
    expect(result.scores).toHaveLength(4);
    const stored = await RecoveryCase.findById(recoveryCase._id);
    expect(stored?.latestScores).toMatchObject({ scorerVersion: "logistic-v1", datasetVersion: "synthetic-recovery-v1" });
    expect(stored?.status).toBe("DIAGNOSED");
    expect(stored?.actions).toHaveLength(0);
    expect(stored?.decisions).toHaveLength(0);
    expect((await Subscription.findById(subscription._id))?.statistics?.toObject()).toEqual(before);
  });

  it("rejects DETECTED cases with a diagnosis-required error", async () => {
    const { recoveryCase } = await fixture("DETECTED");
    await expect(scoreRecoveryCase(recoveryCase.id)).rejects.toMatchObject({ statusCode: 409, message: "Diagnosis required before scoring." });
  });

  it.each(["RECOVERED", "STOPPED"] as const)("rejects closed %s cases", async (status) => {
    const { recoveryCase } = await fixture(status);
    await expect(scoreRecoveryCase(recoveryCase.id)).rejects.toMatchObject({ statusCode: 409 });
  });
});
