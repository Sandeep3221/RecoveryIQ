import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/razorpay/RazorpayDowntimeService.js", () => ({
  razorpayDowntimeService: { getContext: async (method: string, checkedAt = new Date()) => ({ checked: false, active: false, matched: false, matchLevel: "UNKNOWN", method: method === "unknown" ? null : method, severity: null, downtimeId: null, checkedAt, candidatesFound: 0, explanation: "Fixture downtime unavailable." }) },
}));
import { app } from "../src/app.js";
import { AuditEvent } from "../src/models/AuditEvent.js";
import { FailureEvent } from "../src/models/FailureEvent.js";
import { RecoveryCase } from "../src/models/RecoveryCase.js";
import { Subscription } from "../src/models/Subscription.js";
import { WebhookEvent } from "../src/models/WebhookEvent.js";
import { razorpayInvoiceService } from "../src/services/razorpay/RazorpayInvoiceService.js";

const webhookSecret = "fixture_webhook_secret";
let memoryMongo: MongoMemoryServer;

function subscriptionEntity(id: string, status: string) {
  return { id, entity: "subscription", status, plan_id: "plan_fixture", customer_id: "cust_fixture", current_start: null, current_end: null, charge_at: null };
}

function paymentEntity(id = "pay_fixture_001", method = "card") {
  return { id, entity: "payment", amount: 69900, currency: "INR", status: "failed", method, invoice_id: "inv_fixture", order_id: "order_fixture", error_code: "BAD_REQUEST_ERROR", error_description: "Fixture failure", error_source: null, error_step: null, error_reason: null, created_at: 1_700_000_050 };
}
function successfulPaymentEntity(id: string, createdAt = 1_700_000_400) { return { ...paymentEntity(id), status: "captured", created_at: createdAt, error_code: null, error_description: null }; }

function paymentFailedPayload(payment: Record<string, unknown>, createdAt = 1_700_000_100) {
  return { entity: "event", event: "payment.failed", account_id: "acc_fixture", created_at: createdAt, payload: { payment: { entity: payment } } };
}

function payload(event: string, status: string, createdAt: number, options?: { payment?: Record<string, unknown> | null; subscriptionId?: string }) {
  const subscriptionId = options?.subscriptionId ?? "sub_fixture_001";
  return { entity: "event", event, account_id: "acc_fixture", created_at: createdAt, payload: {
    subscription: { entity: subscriptionEntity(subscriptionId, status) },
    ...(options?.payment === null ? {} : { payment: { entity: options?.payment ?? paymentEntity() } }),
  } };
}

async function sendSigned(eventId: string, body: object, valid = true) {
  const raw = JSON.stringify(body);
  const signature = valid ? createHmac("sha256", webhookSecret).update(raw).digest("hex") : "0".repeat(64);
  return request(app).post("/api/webhooks/razorpay").set("Content-Type", "application/json").set("x-razorpay-event-id", eventId).set("X-Razorpay-Signature", signature).send(raw);
}

async function createLocalSubscription(id = "sub_fixture_001", status = "active") {
  return Subscription.create({
    razorpaySubscriptionId: id, razorpayPlanId: "plan_fixture", razorpayCustomerId: "cust_fixture",
    customer: { name: "Fixture User", email: "fixture@example.test" },
    plan: { name: "CloudDesk Pro", amountMinor: 69900, currency: "INR" }, status,
    razorpayCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

beforeAll(async () => {
  memoryMongo = await MongoMemoryServer.create();
  await mongoose.connect(memoryMongo.getUri());
  await Promise.all([Subscription.syncIndexes(), WebhookEvent.syncIndexes(), FailureEvent.syncIndexes(), RecoveryCase.syncIndexes(), AuditEvent.syncIndexes()]);
}, 120_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([Subscription.deleteMany({}), WebhookEvent.deleteMany({}), FailureEvent.deleteMany({}), RecoveryCase.deleteMany({}), AuditEvent.deleteMany({})]);
});

afterAll(async () => { await mongoose.disconnect(); await memoryMongo.stop(); });

describe("Razorpay webhook infrastructure", () => {
  it("accepts a valid raw-body signature and ignores an unknown event", async () => {
    const response = await sendSigned("evt_fixture_unknown", { event: "subscription.fixture", created_at: 1_700_000_000, payload: {} });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect((await WebhookEvent.findOne({ razorpayEventId: "evt_fixture_unknown" }))?.processingStatus).toBe("IGNORED");
  });

  it("rejects an invalid signature before persistence", async () => {
    const response = await sendSigned("evt_fixture_invalid", payload("subscription.pending", "pending", 1_700_000_000), false);
    expect(response.status).toBe(401);
    expect(await WebhookEvent.countDocuments()).toBe(0);
  });

  it("deduplicates pending without repeating effects", async () => {
    await createLocalSubscription();
    const body = payload("subscription.pending", "pending", 1_700_000_000);
    expect((await sendSigned("evt_fixture_duplicate", body)).status).toBe(200);
    expect((await sendSigned("evt_fixture_duplicate", body)).body).toEqual({ received: true, duplicate: true });
    expect(await WebhookEvent.countDocuments()).toBe(1);
    expect(await FailureEvent.countDocuments()).toBe(1);
    expect(await RecoveryCase.countDocuments()).toBe(1);
    expect(await AuditEvent.countDocuments({ eventType: "WEBHOOK_DUPLICATE" })).toBe(1);
    expect((await Subscription.findOne())?.statistics?.failedPayments).toBe(1);
  });

  it("opens and diagnoses one case while tolerating unknown payment fields", async () => {
    await createLocalSubscription();
    const unusualPayment = { ...paymentEntity("pay_fixture_unknown", "crypto"), error_code: null, error_description: null, error_source: null, error_step: null, error_reason: null };
    expect((await sendSigned("evt_fixture_pending", payload("subscription.pending", "pending", 1_700_000_100, { payment: unusualPayment }))).status).toBe(200);
    expect((await Subscription.findOne())?.status).toBe("pending");
    expect((await FailureEvent.findOne())?.paymentMethod).toBe("unknown");
    const recoveryCase = await RecoveryCase.findOne();
    expect(recoveryCase?.status).toBe("DIAGNOSED");
    expect(recoveryCase?.revenueAtRiskMinor).toBe(69900);
    expect(recoveryCase?.failureEventIds).toHaveLength(1);
  });

  it("does not duplicate failure evidence or counters for the same payment across event IDs", async () => {
    await createLocalSubscription();
    const first = payload("subscription.pending", "pending", 1_700_000_110, { payment: paymentEntity("pay_fixture_same_attempt") });
    const second = payload("subscription.pending", "pending", 1_700_000_120, { payment: paymentEntity("pay_fixture_same_attempt") });
    expect((await sendSigned("evt_fixture_attempt_a", first)).status).toBe(200);
    expect((await sendSigned("evt_fixture_attempt_b", second)).status).toBe(200);
    expect(await FailureEvent.countDocuments()).toBe(1);
    expect(await RecoveryCase.countDocuments()).toBe(1);
    expect((await RecoveryCase.findOne())?.failureEventIds).toHaveLength(1);
    expect((await Subscription.findOne())?.statistics?.failedPayments).toBe(1);
  });

  it("updates halted state and keeps a diagnosed case open", async () => {
    await createLocalSubscription();
    expect((await sendSigned("evt_fixture_halted", payload("subscription.halted", "halted", 1_700_000_200, { payment: paymentEntity("pay_fixture_halted") }))).status).toBe(200);
    expect((await Subscription.findOne())?.status).toBe("halted");
    expect((await RecoveryCase.findOne())?.status).toBe("DIAGNOSED");
    expect(await AuditEvent.countDocuments({ eventType: "SUBSCRIPTION_HALTED" })).toBe(1);
  });

  it("updates activated state without closing an open case", async () => {
    const local = await createLocalSubscription("sub_fixture_001", "authenticated");
    await RecoveryCase.create({ subscriptionId: local._id, razorpaySubscriptionId: local.razorpaySubscriptionId, status: "DETECTED", openedAt: new Date(), revenueAtRiskMinor: 69900, recoveredAmountMinor: 0 });
    expect((await sendSigned("evt_fixture_activated", payload("subscription.activated", "active", 1_700_000_250, { payment: null }))).status).toBe(200);
    expect((await Subscription.findById(local._id))?.status).toBe("active");
    expect((await RecoveryCase.findOne())?.status).toBe("DETECTED");
  });

  it("recovers on charged and never double-counts a duplicate", async () => {
    await createLocalSubscription();
    await sendSigned("evt_fixture_failure", payload("subscription.pending", "pending", 1_700_000_300, { payment: paymentEntity("pay_fixture_failed") }));
    await RecoveryCase.updateOne({}, { $set: { status: "ACTION_EXECUTED" } });
    const charged = payload("subscription.charged", "active", 1_700_000_400, { payment: successfulPaymentEntity("pay_fixture_recovered") });
    expect((await sendSigned("evt_fixture_charged", charged)).status).toBe(200);
    expect((await sendSigned("evt_fixture_charged", charged)).body.duplicate).toBe(true);
    const local = await Subscription.findOne();
    const recoveryCase = await RecoveryCase.findOne();
    expect(local?.statistics?.successfulPayments).toBe(1);
    expect(local?.statistics?.recoveredPayments).toBe(1);
    expect(local?.statistics?.consecutiveFailures).toBe(0);
    expect(recoveryCase?.status).toBe("RECOVERED");
    expect(recoveryCase?.recoveredAmountMinor).toBe(69900);
    expect(recoveryCase?.outcome?.nativeRecovery).toBeNull();
    expect(recoveryCase?.outcome?.recoveredPaymentId).toBe("pay_fixture_recovered");
  });

  it("stops an open case when cancelled", async () => {
    await createLocalSubscription();
    await sendSigned("evt_fixture_cancel_failure", payload("subscription.pending", "pending", 1_700_000_500));
    expect((await sendSigned("evt_fixture_cancelled", payload("subscription.cancelled", "cancelled", 1_700_000_600, { payment: null }))).status).toBe(200);
    expect((await Subscription.findOne())?.status).toBe("cancelled");
    expect((await RecoveryCase.findOne())?.status).toBe("STOPPED");
    expect((await RecoveryCase.findOne())?.outcome?.finalReason).toBe("SUBSCRIPTION_CANCELLED");
  });

  it("ignores older pending after charged and does not reopen", async () => {
    await createLocalSubscription();
    await sendSigned("evt_fixture_initial_pending", payload("subscription.pending", "pending", 1_700_000_700, { payment: paymentEntity("pay_fixture_initial") }));
    await sendSigned("evt_fixture_newer_charged", payload("subscription.charged", "active", 1_700_000_900, { payment: successfulPaymentEntity("pay_fixture_success", 1_700_000_900) }));
    await sendSigned("evt_fixture_stale_pending", payload("subscription.pending", "pending", 1_700_000_800, { payment: paymentEntity("pay_fixture_stale") }));
    expect((await Subscription.findOne())?.status).toBe("active");
    expect(await RecoveryCase.countDocuments()).toBe(1);
    expect((await RecoveryCase.findOne())?.status).toBe("RECOVERED");
    expect((await WebhookEvent.findOne({ razorpayEventId: "evt_fixture_stale_pending" }))?.processingStatus).toBe("IGNORED");
    expect(await FailureEvent.countDocuments()).toBe(1);
  });

  it("correlates payment.failed through its invoice and refreshes an existing sparse diagnosis", async () => {
    await createLocalSubscription("sub_fixture_001", "active");
    await sendSigned("evt_sparse_pending", payload("subscription.pending", "pending", 1_700_000_000, { payment: null }));
    vi.spyOn(razorpayInvoiceService, "fetchForCorrelation").mockResolvedValue({ invoiceId: "inv_fixture", subscriptionId: "sub_fixture_001", paymentId: "pay_real_evidence", orderId: "order_fixture" });
    const payment = { ...paymentEntity("pay_real_evidence", "card"), error_reason: "insufficient_funds", error_source: "customer", card: { last4: "1111" }, vpa: "private@example" };
    expect((await sendSigned("evt_payment_failed", paymentFailedPayload(payment))).status).toBe(200);
    const failure = await FailureEvent.findOne();
    const recoveryCase = await RecoveryCase.findOne();
    expect(await RecoveryCase.countDocuments()).toBe(1);
    expect(failure?.normalizedCategory).toBe("TEMPORARY_FUNDS");
    expect(failure?.classification?.matchedBy).toBe("EXACT_REASON");
    expect(recoveryCase?.status).toBe("DIAGNOSED");
    expect(recoveryCase?.failureEventIds).toHaveLength(1);
    expect((recoveryCase?.latestContext as { failure?: { category?: string } })?.failure?.category).toBe("TEMPORARY_FUNDS");
    expect((await Subscription.findOne())?.statistics?.failedPayments).toBe(1);
    const stored = failure?.toObject() as Record<string, unknown>;
    expect(stored.card).toBeUndefined();
    expect(stored.vpa).toBeUndefined();
  });

  it("deduplicates payment.failed by event ID and payment ID without double counting", async () => {
    await createLocalSubscription("sub_fixture_001", "pending");
    vi.spyOn(razorpayInvoiceService, "fetchForCorrelation").mockResolvedValue({ invoiceId: "inv_fixture", subscriptionId: "sub_fixture_001", paymentId: "pay_once", orderId: null });
    const body = paymentFailedPayload(paymentEntity("pay_once"));
    await sendSigned("evt_payment_once", body);
    expect((await sendSigned("evt_payment_once", body)).body).toEqual({ received: true, duplicate: true });
    await sendSigned("evt_payment_same_attempt", body);
    expect(await FailureEvent.countDocuments()).toBe(1);
    expect(await RecoveryCase.countDocuments()).toBe(1);
    expect((await Subscription.findOne())?.statistics?.failedPayments).toBe(1);
  });

  it.each([
    ["invoice without subscription", { invoiceId: "inv_fixture", subscriptionId: null, paymentId: "pay_uncorrelated", orderId: null }],
    ["invoice lookup failure", null],
    ["untracked subscription", { invoiceId: "inv_fixture", subscriptionId: "sub_not_tracked", paymentId: "pay_uncorrelated", orderId: null }],
  ])("ignores payment.failed when %s", async (_label, invoice) => {
    await createLocalSubscription();
    vi.spyOn(razorpayInvoiceService, "fetchForCorrelation").mockResolvedValue(invoice);
    await sendSigned(`evt_${String(_label).replaceAll(" ", "_")}`, paymentFailedPayload(paymentEntity("pay_uncorrelated")));
    expect(await FailureEvent.countDocuments()).toBe(0);
    expect(await RecoveryCase.countDocuments()).toBe(0);
    expect((await WebhookEvent.findOne({ eventType: "payment.failed" }))?.processingStatus).toBe("IGNORED");
  });

  it("preserves evidence received before pending and attaches it when pending arrives", async () => {
    await createLocalSubscription("sub_fixture_001", "active");
    vi.spyOn(razorpayInvoiceService, "fetchForCorrelation").mockResolvedValue({ invoiceId: "inv_fixture", subscriptionId: "sub_fixture_001", paymentId: "pay_before_pending", orderId: null });
    await sendSigned("evt_payment_before", paymentFailedPayload({ ...paymentEntity("pay_before_pending"), error_source: "bank" }));
    expect(await FailureEvent.countDocuments()).toBe(1);
    expect(await RecoveryCase.countDocuments()).toBe(0);
    await sendSigned("evt_pending_after", payload("subscription.pending", "pending", 1_700_000_200, { payment: null }));
    const recoveryCase = await RecoveryCase.findOne();
    expect(await RecoveryCase.countDocuments()).toBe(1);
    expect(recoveryCase?.failureEventIds).toHaveLength(1);
    expect(recoveryCase?.status).toBe("DIAGNOSED");
    expect((recoveryCase?.latestContext as { failure?: { category?: string } })?.failure?.category).toBe("BANK_OR_NETWORK");
  });
});
