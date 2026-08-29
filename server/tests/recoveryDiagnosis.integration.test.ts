import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditEvent } from "../src/models/AuditEvent.js";
import { FailureEvent } from "../src/models/FailureEvent.js";
import { RecoveryCase } from "../src/models/RecoveryCase.js";
import { Subscription } from "../src/models/Subscription.js";
import { diagnoseRecoveryCase } from "../src/services/recovery/RecoveryDiagnosisService.js";
import { razorpayDowntimeService, type DowntimeContext } from "../src/services/razorpay/RazorpayDowntimeService.js";

let memoryMongo: MongoMemoryServer;
const checkedAt = new Date("2026-08-28T12:00:00.000Z");
const downtime: DowntimeContext = { checked: true, active: false, matched: false, matchLevel: "METHOD_ONLY", method: "card", severity: "medium", downtimeId: "down_fixture", checkedAt, candidatesFound: 1, explanation: "Instrument-specific fixture downtime." };

beforeAll(async () => {
  memoryMongo = await MongoMemoryServer.create();
  await mongoose.connect(memoryMongo.getUri());
  await Promise.all([Subscription.syncIndexes(), FailureEvent.syncIndexes(), RecoveryCase.syncIndexes(), AuditEvent.syncIndexes()]);
}, 120_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([Subscription.deleteMany({}), FailureEvent.deleteMany({}), RecoveryCase.deleteMany({}), AuditEvent.deleteMany({})]);
});

afterAll(async () => { await mongoose.disconnect(); await memoryMongo.stop(); });

async function fixture(status: "DETECTED" | "RECOVERED" | "STOPPED" = "DETECTED", withFailure = true) {
  const subscription = await Subscription.create({ razorpaySubscriptionId: "sub_diagnosis_fixture", customer: { name: "Fixture User", email: "fixture@example.test" }, plan: { name: "CloudDesk Pro", amountMinor: 69900, currency: "INR" }, status: "pending", statistics: { successfulPayments: 2, failedPayments: 1, recoveredPayments: 0, consecutiveFailures: 1, nudgesSent: 0 }, razorpayCreatedAt: new Date("2026-08-20T12:00:00.000Z") });
  const failure = withFailure ? await FailureEvent.create({ webhookEventId: new Types.ObjectId(), razorpaySubscriptionId: subscription.razorpaySubscriptionId, razorpayPaymentId: "pay_diagnosis_fixture", amountMinor: 69900, currency: "INR", paymentMethod: "card", razorpayError: { code: "BAD_REQUEST_ERROR", description: "Fixture", source: "bank", step: null, reason: "insufficient_funds" }, normalizedCategory: "UNKNOWN", occurredAt: new Date("2026-08-28T11:00:00.000Z") }) : null;
  const recoveryCase = await RecoveryCase.create({ subscriptionId: subscription._id, razorpaySubscriptionId: subscription.razorpaySubscriptionId, status, openedAt: new Date("2026-08-28T11:00:00.000Z"), closedAt: status === "DETECTED" ? null : new Date(), revenueAtRiskMinor: 69900, recoveredAmountMinor: 0, failureEventIds: failure ? [failure._id] : [] });
  return { subscription, failure, recoveryCase };
}

describe("RecoveryDiagnosisService", () => {
  it("persists classification, downtime, context, status, and audit records idempotently", async () => {
    vi.spyOn(razorpayDowntimeService, "getContext").mockResolvedValue(downtime);
    const { recoveryCase } = await fixture();
    const first = await diagnoseRecoveryCase(recoveryCase.id, checkedAt);
    expect(first.case.status).toBe("DIAGNOSED");
    expect(first.classification).toMatchObject({ category: "TEMPORARY_FUNDS", confidence: "HIGH", matchedBy: "EXACT_REASON" });
    const failure = await FailureEvent.findOne();
    expect(failure?.normalizedCategory).toBe("TEMPORARY_FUNDS");
    expect(failure?.classification?.version).toBe("classifier-v1");
    expect(failure?.downtimeSnapshot).toMatchObject({ checked: true, active: false, matchLevel: "METHOD_ONLY" });
    expect((await RecoveryCase.findById(recoveryCase._id))?.latestContext).toMatchObject({ failure: { category: "TEMPORARY_FUNDS" }, downtime: { matchLevel: "METHOD_ONLY" } });
    expect(await AuditEvent.countDocuments({ recoveryCaseId: recoveryCase._id })).toBe(3);

    await diagnoseRecoveryCase(recoveryCase.id, new Date("2026-08-28T12:05:00.000Z"));
    expect(await RecoveryCase.countDocuments()).toBe(1);
    expect(await FailureEvent.countDocuments()).toBe(1);
    expect(await AuditEvent.countDocuments({ recoveryCaseId: recoveryCase._id })).toBe(3);
    expect((await Subscription.findById(first.case.subscriptionId))?.statistics?.failedPayments).toBe(1);
  });

  it.each(["RECOVERED", "STOPPED"] as const)("rejects closed %s cases", async (status) => {
    vi.spyOn(razorpayDowntimeService, "getContext").mockResolvedValue(downtime);
    const { recoveryCase } = await fixture(status);
    await expect(diagnoseRecoveryCase(recoveryCase.id)).rejects.toMatchObject({ statusCode: 409 });
    expect((await RecoveryCase.findById(recoveryCase._id))?.status).toBe(status);
  });

  it("allows UNKNOWN diagnosis and continues when downtime lookup is unavailable", async () => {
    vi.spyOn(razorpayDowntimeService, "getContext").mockResolvedValue({ ...downtime, checked: false, matchLevel: "UNKNOWN", method: null, severity: null, downtimeId: null, candidatesFound: 0, explanation: "Lookup unavailable." });
    const { recoveryCase } = await fixture("DETECTED", false);
    const result = await diagnoseRecoveryCase(recoveryCase.id, checkedAt);
    expect(result.classification.category).toBe("UNKNOWN");
    expect(result.downtime.checked).toBe(false);
    expect(result.context.failure).toMatchObject({ category: "UNKNOWN", failureCount: 0, paymentMethod: "unknown" });
    expect(result.case.status).toBe("DIAGNOSED");
  });
});
