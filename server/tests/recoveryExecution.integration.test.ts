import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { AuditEvent } from "../src/models/AuditEvent.js";
import { RecoveryCase } from "../src/models/RecoveryCase.js";
import { Subscription } from "../src/models/Subscription.js";
import type { RecoveryActionType } from "../src/domain/types.js";
import type { RecoveryNotificationService } from "../src/services/notifications/RecoveryNotificationService.js";
import { executeRecoveryDecision } from "../src/services/recovery/RecoveryExecutionService.js";
import { getCardUpdateRecoverySession, verifyCardUpdateRecovery } from "../src/services/recovery/CardUpdateRecoveryService.js";

let memoryMongo: MongoMemoryServer;
beforeAll(async () => { memoryMongo = await MongoMemoryServer.create(); await mongoose.connect(memoryMongo.getUri()); }, 120_000);
beforeEach(async () => { await Promise.all([AuditEvent.deleteMany({}), RecoveryCase.deleteMany({}), Subscription.deleteMany({})]); });
afterAll(async () => { await mongoose.disconnect(); await memoryMongo.stop(); });

async function fixture(action: RecoveryActionType, options: { status?: string; stale?: boolean; decision?: boolean; context?: boolean } = {}) {
  const subscription = await Subscription.create({ razorpaySubscriptionId: `sub_execute_${action}_${Date.now()}`, customer: { name: "Asha Rao", email: "asha@example.test" }, plan: { name: "CloudDesk Pro", amountMinor: 69900, currency: "INR" }, status: "pending", razorpayCreatedAt: new Date("2026-08-20T00:00:00Z"), statistics: { successfulPayments: 2, failedPayments: 1, recoveredPayments: 0, consecutiveFailures: 1, nudgesSent: 0 } });
  const contextAt = new Date("2026-08-28T10:00:00Z"); const scoreAt = new Date("2026-08-28T11:00:00Z"); const decidedAt = options.stale ? new Date("2026-08-28T10:30:00Z") : new Date("2026-08-28T12:00:00Z");
  const scores = ["WAIT_NATIVE_RETRY", "SEND_NUDGE", "REQUEST_CARD_UPDATE", "STOP_AND_ESCALATE"].map((candidate) => ({ action: candidate, probability: candidate === action ? 0.8 : 0.2, expectedRecoveredMinor: candidate === action ? 55920 : 13980, scorerVersion: "logistic-v1", datasetVersion: "synthetic-recovery-v1", explanation: "fixture" }));
  const latestContext = options.context === false ? null : { generatedAt: contextAt, caseId: "fixture", subscription: { id: String(subscription._id), status: "pending", amountMinor: 69900, ageDays: 1, nativeRetryPossible: true }, failure: { category: "UNKNOWN", reason: null, source: null, step: null, paymentMethod: "card", failureCount: 1, consecutiveFailureCount: 1 }, customerHistory: { previousSuccessfulPayments: 2, previousFailedPayments: 1, previousRecoveredPayments: 0, previousRecoveryRate: 0, previousNudges: 0, hoursSinceLastNudge: null }, diagnosis: { classifierVersion: "classifier-v1", confidence: "LOW", explanation: "fixture" }, downtime: { checked: true, active: true, method: "card", severity: "high", matchLevel: "EXACT" }, caseState: { caseAgeHours: 1, revenueAtRiskMinor: 69900, previousActions: [] } };
  const latestDecision = options.decision === false ? null : { decisionId: `decision_${action}`, policyVersion: "policy-v1", scorerVersion: "logistic-v1", selectedAction: action, selectedProbability: 0.8, expectedRecoveredMinor: 55920, reasonCode: "MODEL_SELECTED_BEST_ALLOWED_ACTION", explanation: "fixture", hardRuleApplied: false, allowedActions: [action], blockedActions: [], decidedAt };
  const status = options.status ?? "DECIDED";
  const recoveryCase = await RecoveryCase.create({ subscriptionId: subscription._id, razorpaySubscriptionId: subscription.razorpaySubscriptionId, status, openedAt: contextAt, closedAt: status === "RECOVERED" ? new Date() : null, revenueAtRiskMinor: 69900, recoveredAmountMinor: 0, latestContext, latestScores: { scorerVersion: "logistic-v1", datasetVersion: "synthetic-recovery-v1", generatedAt: scoreAt, scores }, latestDecision });
  return { subscription, recoveryCase };
}

describe("bounded RecoveryDecision execution", () => {
  it("executes WAIT once without counters, notifications, or custom retries", async () => {
    const { subscription, recoveryCase } = await fixture("WAIT_NATIVE_RETRY"); const before = subscription.statistics!.toObject();
    const notifications = { send: vi.fn() } as unknown as RecoveryNotificationService;
    const first = await executeRecoveryDecision(recoveryCase.id, new Date("2026-08-28T13:00:00Z"), notifications); const second = await executeRecoveryDecision(recoveryCase.id, new Date("2026-08-28T14:00:00Z"), notifications);
    expect(first).toMatchObject({ caseStatus: "ACTION_EXECUTED", action: { type: "WAIT_NATIVE_RETRY", status: "EXECUTED", metadata: { retryOwner: "razorpay", customRetryScheduled: false } } });
    expect(second.action.actionId).toBe(first.action.actionId); expect(notifications.send).not.toHaveBeenCalled();
    const stored = await RecoveryCase.findById(recoveryCase._id); expect(stored?.actions).toHaveLength(1); expect((await Subscription.findById(subscription._id))?.statistics?.toObject()).toEqual(before);
    expect(await AuditEvent.countDocuments({ recoveryCaseId: recoveryCase._id, eventType: "WAITING_FOR_NATIVE_RETRY" })).toBe(1);
  });

  it("simulates a deterministic nudge without counting customer contact", async () => {
    const { subscription, recoveryCase } = await fixture("SEND_NUDGE"); const result = await executeRecoveryDecision(recoveryCase.id, new Date("2026-08-28T13:00:00Z"));
    expect(result.action).toMatchObject({ status: "EXECUTED", executionMode: "simulation", metadata: { deliveryMode: "simulation", deliveryStatus: "simulated", customerContacted: false, templateVersion: "recovery-nudge-v1", subject: "Action needed for your CloudDesk subscription" } });
    expect(String(result.action.metadata.content)).toContain("Hi Asha,"); expect((await Subscription.findById(subscription._id))?.statistics?.nudgesSent).toBe(0); expect((await Subscription.findById(subscription._id))?.lastNudgeAt).toBeNull();
  });

  it("counts a mocked live delivery once and never resends", async () => {
    const { subscription, recoveryCase } = await fixture("SEND_NUDGE"); const send = vi.fn().mockResolvedValue({ deliveryMode: "live", customerContacted: true, deliveryStatus: "delivered", providerMessageId: "mock_message" });
    const provider = { send } satisfies RecoveryNotificationService; await executeRecoveryDecision(recoveryCase.id, new Date("2026-08-28T13:00:00Z"), provider); await executeRecoveryDecision(recoveryCase.id, new Date("2026-08-28T14:00:00Z"), provider);
    expect(send).toHaveBeenCalledTimes(1); expect((await Subscription.findById(subscription._id))?.statistics?.nudgesSent).toBe(1);
  });

  it("records provider failure without selecting a fallback", async () => {
    const { recoveryCase } = await fixture("SEND_NUDGE"); const provider: RecoveryNotificationService = { send: vi.fn().mockRejectedValue(new Error("provider unavailable")) };
    const result = await executeRecoveryDecision(recoveryCase.id, new Date("2026-08-28T13:00:00Z"), provider);
    expect(result).toMatchObject({ caseStatus: "ACTION_PENDING", action: { status: "FAILED" } }); expect(result.action.failureReason).toContain("provider unavailable"); expect((await RecoveryCase.findById(recoveryCase._id))?.actions).toHaveLength(1);
  });

  it("stops once for merchant review", async () => {
    const { recoveryCase } = await fixture("STOP_AND_ESCALATE"); const first = await executeRecoveryDecision(recoveryCase.id); const second = await executeRecoveryDecision(recoveryCase.id);
    expect(first).toMatchObject({ caseStatus: "STOPPED", action: { status: "EXECUTED", metadata: { escalationTarget: "merchant_review" } } }); expect(second.action.actionId).toBe(first.action.actionId); expect((await RecoveryCase.findById(recoveryCase._id))?.actions).toHaveLength(1);
  });

  it.each(["DETECTED", "DIAGNOSED", "RECOVERED"])("rejects %s without execution", async (status) => { const { recoveryCase } = await fixture("WAIT_NATIVE_RETRY", { status }); await expect(executeRecoveryDecision(recoveryCase.id)).rejects.toMatchObject({ statusCode: 409 }); });
  it("rejects a missing decision", async () => { const { recoveryCase } = await fixture("WAIT_NATIVE_RETRY", { decision: false }); await expect(executeRecoveryDecision(recoveryCase.id)).rejects.toMatchObject({ message: "A current RecoveryDecision is required before execution." }); });
  it("rejects a stale decision", async () => { const { recoveryCase } = await fixture("WAIT_NATIVE_RETRY", { stale: true }); await expect(executeRecoveryDecision(recoveryCase.id)).rejects.toMatchObject({ message: "Recovery decision is stale. Diagnose, score, and decide again before execution." }); });
  it("ignores a client action override and executes only the selected action", async () => { const { recoveryCase } = await fixture("WAIT_NATIVE_RETRY"); const response = await request(app).post(`/api/v1/recovery-cases/${recoveryCase.id}/execute`).send({ action: "SEND_NUDGE" }).expect(200); expect(response.body.action.type).toBe("WAIT_NATIVE_RETRY"); });
});

describe("card update recovery session", () => {
  it("stores only a token hash, validates expiry, and exposes the raw URL once", async () => {
    const { recoveryCase } = await fixture("REQUEST_CARD_UPDATE"); const result = await executeRecoveryDecision(recoveryCase.id, new Date());
    expect(result).toMatchObject({ caseStatus: "ACTION_PENDING", action: { status: "PENDING" } }); expect(result.recoveryUrl).toMatch(/\/recover\/card\//); expect(JSON.stringify(result.action)).not.toContain("tokenHash");
    const token = result.recoveryUrl!.split("/").at(-1)!; const stored = await RecoveryCase.findById(recoveryCase._id); expect(stored?.actions[0]?.metadata?.tokenHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(stored)).not.toContain(token);
    const publicSession = await getCardUpdateRecoverySession(token); expect(publicSession.checkout).toMatchObject({ subscription_id: recoveryCase.razorpaySubscriptionId, subscription_card_change: true });
    const duplicate = await executeRecoveryDecision(recoveryCase.id); expect(duplicate.recoveryUrl).toBeUndefined();
  });

  it("rejects invalid and expired tokens", async () => {
    await expect(getCardUpdateRecoverySession("not-a-real-token-value-12345")).rejects.toMatchObject({ statusCode: 404 });
    const { recoveryCase } = await fixture("REQUEST_CARD_UPDATE"); const result = await executeRecoveryDecision(recoveryCase.id, new Date("2020-01-01T00:00:00Z")); const token = result.recoveryUrl!.split("/").at(-1)!; await expect(getCardUpdateRecoverySession(token)).rejects.toMatchObject({ statusCode: 410 });
  });

  it("uses the authoritative subscription id, verifies signature, and does not mark recovery", async () => {
    const { recoveryCase } = await fixture("REQUEST_CARD_UPDATE"); const result = await executeRecoveryDecision(recoveryCase.id, new Date()); const token = result.recoveryUrl!.split("/").at(-1)!; const paymentId = "pay_card_change_fixture";
    const signature = createHmac("sha256", "fixture_key_secret").update(`${paymentId}|${recoveryCase.razorpaySubscriptionId}`).digest("hex");
    await expect(verifyCardUpdateRecovery({ token, razorpay_payment_id: paymentId, razorpay_subscription_id: "sub_browser_override", razorpay_signature: signature })).rejects.toMatchObject({ statusCode: 400 });
    await expect(verifyCardUpdateRecovery({ token, razorpay_payment_id: paymentId, razorpay_subscription_id: recoveryCase.razorpaySubscriptionId, razorpay_signature: "00".repeat(32) })).rejects.toMatchObject({ statusCode: 400 });
    const verified = await verifyCardUpdateRecovery({ token, razorpay_payment_id: paymentId, razorpay_subscription_id: recoveryCase.razorpaySubscriptionId, razorpay_signature: signature }); expect(verified).toMatchObject({ caseStatus: "ACTION_EXECUTED", actionStatus: "EXECUTED", recovered: false });
    const stored = await RecoveryCase.findById(recoveryCase._id); expect(stored).toMatchObject({ status: "ACTION_EXECUTED", recoveredAmountMinor: 0, outcome: { recovered: false } }); await expect(getCardUpdateRecoverySession(token)).rejects.toMatchObject({ statusCode: 409 });
  });
});
