import { mongo, type Types } from "mongoose";
import type { SubscriptionStatus } from "../../domain/types.js";
import { AuditEvent } from "../../models/AuditEvent.js";
import { FailureEvent } from "../../models/FailureEvent.js";
import { RecoveryCase } from "../../models/RecoveryCase.js";
import { Subscription } from "../../models/Subscription.js";
import { WebhookEvent } from "../../models/WebhookEvent.js";
import { AppError } from "../../utils/AppError.js";
import { mapRazorpaySubscriptionStatus } from "./RazorpaySubscriptionService.js";
import type { NormalizedRazorpayEvent, NormalizedRazorpayPayment, NormalizedRazorpaySubscription } from "./RazorpayEventNormalizer.js";
import { diagnoseRecoveryCase } from "../recovery/RecoveryDiagnosisService.js";
import { razorpayInvoiceService } from "./RazorpayInvoiceService.js";
import { trackRecoveryOutcome } from "../recovery/RecoveryOutcomeService.js";

export const HANDLED_RAZORPAY_EVENTS = ["payment.failed", "subscription.pending", "subscription.halted", "subscription.charged", "subscription.activated", "subscription.cancelled"] as const;
const OPEN_CASE_STATUSES = ["DETECTED", "DIAGNOSED", "DECIDED", "ACTION_PENDING", "ACTION_EXECUTED"] as const;
const TERMINAL_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["cancelled", "completed"];

export function canApplySubscriptionStatus(current: SubscriptionStatus, next: SubscriptionStatus): boolean {
  if (TERMINAL_SUBSCRIPTION_STATUSES.includes(current)) return current === next;
  if (current === "active" && (next === "created" || next === "authenticated")) return false;
  return true;
}

function unixDate(value: number | null): Date | null { return value && value > 0 ? new Date(value * 1000) : null; }

async function audit(input: {
  recoveryCaseId?: Types.ObjectId | null;
  razorpaySubscriptionId?: string | null;
  eventType: string;
  title: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
}): Promise<void> {
  await AuditEvent.create({
    recoveryCaseId: input.recoveryCaseId ?? null,
    razorpaySubscriptionId: input.razorpaySubscriptionId ?? null,
    eventType: input.eventType,
    actor: "RAZORPAY",
    title: input.title,
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt,
  });
}

async function findOpenCase(subscriptionId: Types.ObjectId) {
  return RecoveryCase.findOne({ subscriptionId, status: { $in: OPEN_CASE_STATUSES } }).sort({ openedAt: -1 });
}

async function openOrReuseCase(local: InstanceType<typeof Subscription>, revenueAtRiskMinor: number, occurredAt: Date) {
  const existing = await findOpenCase(local._id);
  if (existing) return existing;
  return RecoveryCase.create({
    subscriptionId: local._id,
    razorpaySubscriptionId: local.razorpaySubscriptionId,
    status: "DETECTED",
    openedAt: occurredAt,
    closedAt: null,
    revenueAtRiskMinor,
    recoveredAmountMinor: 0,
    failureEventIds: [],
    decisions: [],
    actions: [],
    outcome: { recovered: false, recoveredAt: null, recoveredPaymentId: null, nativeRecovery: null, finalReason: "UNKNOWN" },
  });
}

async function createFailureEvidence(eventId: Types.ObjectId, subscriptionId: string, payment: NormalizedRazorpayPayment | null, occurredAt: Date) {
  if (!payment?.id || payment.amountMinor === null || payment.currency !== "INR") return { failure: null, created: false };
  try {
    const failure = await FailureEvent.create({
      webhookEventId: eventId,
      razorpaySubscriptionId: subscriptionId,
      razorpayPaymentId: payment.id,
      razorpayInvoiceId: payment.invoiceId,
      amountMinor: payment.amountMinor,
      currency: "INR",
      paymentMethod: payment.method,
      razorpayError: payment.error,
      normalizedCategory: "UNKNOWN",
      downtimeSnapshot: { checked: false, active: false, method: null, severity: null, downtimeId: null, checkedAt: null },
      occurredAt,
    });
    return { failure, created: true };
  } catch (error) {
    if (!(error instanceof mongo.MongoServerError) || error.code !== 11000) throw error;
    return { failure: await FailureEvent.findOne({ razorpayPaymentId: payment.id }), created: false };
  }
}

async function findLatestUnattachedFailure(razorpaySubscriptionId: string) {
  const candidates = await FailureEvent.find({ razorpaySubscriptionId }).sort({ occurredAt: -1 }).limit(10);
  for (const candidate of candidates) {
    const attached = await RecoveryCase.exists({ failureEventIds: candidate._id });
    if (!attached) return candidate;
  }
  return null;
}

async function attachFailure(recoveryCase: InstanceType<typeof RecoveryCase>, failure: InstanceType<typeof FailureEvent> | null): Promise<void> {
  if (failure) await RecoveryCase.updateOne({ _id: recoveryCase._id }, { $addToSet: { failureEventIds: failure._id } });
}

async function recordNewFailure(local: InstanceType<typeof Subscription>, recoveryCase: InstanceType<typeof RecoveryCase> | null, payment: NormalizedRazorpayPayment, occurredAt: Date): Promise<void> {
  await Subscription.updateOne(
    { _id: local._id },
    { $inc: { "statistics.failedPayments": 1, "statistics.consecutiveFailures": 1 }, $set: { lastFailureAt: occurredAt } },
  );
  if (recoveryCase) {
    await audit({
      recoveryCaseId: recoveryCase._id,
      razorpaySubscriptionId: local.razorpaySubscriptionId,
      eventType: "FAILURE_DETECTED",
      title: "Subscription payment failure evidence received",
      metadata: { razorpayPaymentId: payment.id, amountMinor: payment.amountMinor },
      occurredAt,
    });
  }
}

async function diagnoseBestEffort(recoveryCase: InstanceType<typeof RecoveryCase>): Promise<void> {
  try {
    await diagnoseRecoveryCase(recoveryCase.id);
  } catch (error) {
    console.error("Recovery diagnosis enrichment failed", error instanceof Error ? { name: error.name, message: error.message, recoveryCaseId: recoveryCase.id } : { message: "Unknown error", recoveryCaseId: recoveryCase.id });
  }
}

async function updateLocalLifecycle(local: InstanceType<typeof Subscription>, entity: NormalizedRazorpaySubscription, event: NormalizedRazorpayEvent): Promise<boolean> {
  if (event.hasAuthoritativeTimestamp && local.lastWebhookOccurredAt && event.occurredAt < local.lastWebhookOccurredAt) return false;
  const next = mapRazorpaySubscriptionStatus(entity.status);
  if (canApplySubscriptionStatus(local.status, next)) local.status = next;
  if (entity.customerId) local.razorpayCustomerId = entity.customerId;
  if (entity.planId) local.razorpayPlanId = entity.planId;
  local.razorpayCurrentStartAt = unixDate(entity.currentStart);
  local.razorpayCurrentEndAt = unixDate(entity.currentEnd);
  local.razorpayChargeAt = unixDate(entity.chargeAt);
  if (event.hasAuthoritativeTimestamp) local.lastWebhookOccurredAt = event.occurredAt;
  await local.save();
  return true;
}

async function handleFailure(eventRecordId: Types.ObjectId, local: InstanceType<typeof Subscription>, event: NormalizedRazorpayEvent, halted: boolean): Promise<void> {
  const evidence = await createFailureEvidence(eventRecordId, local.razorpaySubscriptionId, event.payment, event.occurredAt);
  const existingEvidence = evidence.failure ?? await findLatestUnattachedFailure(local.razorpaySubscriptionId);
  const risk = existingEvidence?.amountMinor ?? event.payment?.amountMinor ?? local.plan?.amountMinor ?? 0;
  const recoveryCase = await openOrReuseCase(local, risk, event.occurredAt);
  await attachFailure(recoveryCase, existingEvidence);
  if (evidence.created) {
    await recordNewFailure(local, recoveryCase, event.payment!, event.payment?.createdAt ?? event.occurredAt);
  }
  if (halted) await audit({ recoveryCaseId: recoveryCase._id, razorpaySubscriptionId: local.razorpaySubscriptionId, eventType: "SUBSCRIPTION_HALTED", title: "Subscription halted by Razorpay", metadata: { status: "halted", razorpayPaymentId: event.payment?.id }, occurredAt: event.occurredAt });
  await diagnoseBestEffort(recoveryCase);
}

async function handlePaymentFailed(eventRecordId: Types.ObjectId, event: NormalizedRazorpayEvent): Promise<"PROCESSED" | "IGNORED"> {
  const payment = event.payment;
  if (!payment?.id || !payment.invoiceId) return "IGNORED";
  const invoice = await razorpayInvoiceService.fetchForCorrelation(payment.invoiceId);
  if (!invoice?.subscriptionId) return "IGNORED";
  if (invoice.paymentId && invoice.paymentId !== payment.id) return "IGNORED";
  const local = await Subscription.findOne({ razorpaySubscriptionId: invoice.subscriptionId });
  if (!local) return "IGNORED";
  await WebhookEvent.updateOne({ _id: eventRecordId }, { $set: { subscriptionId: local.razorpaySubscriptionId } });
  await audit({ razorpaySubscriptionId: local.razorpaySubscriptionId, eventType: "WEBHOOK_RECEIVED", title: "Razorpay webhook received", metadata: { eventType: event.eventType }, occurredAt: event.occurredAt });
  const occurredAt = payment.createdAt ?? event.occurredAt;
  const evidence = await createFailureEvidence(eventRecordId, local.razorpaySubscriptionId, payment, occurredAt);
  let recoveryCase = await findOpenCase(local._id);
  if (!recoveryCase && (local.status === "pending" || local.status === "halted")) {
    recoveryCase = await openOrReuseCase(local, payment.amountMinor ?? local.plan?.amountMinor ?? 0, occurredAt);
  }
  if (recoveryCase) await attachFailure(recoveryCase, evidence.failure);
  if (evidence.created) await recordNewFailure(local, recoveryCase, payment, occurredAt);
  if (recoveryCase) await diagnoseBestEffort(recoveryCase);
  return "PROCESSED";
}

async function handleCharged(eventRecordId: Types.ObjectId, local: InstanceType<typeof Subscription>, event: NormalizedRazorpayEvent): Promise<void> {
  const paymentId = event.payment?.id;
  const priorPayment = paymentId ? await WebhookEvent.exists({ _id: { $ne: eventRecordId }, eventType: "subscription.charged", paymentId, processingStatus: "PROCESSED" }) : null;
  if (!priorPayment && event.payment?.status === "captured") await Subscription.updateOne({ _id: local._id }, { $inc: { "statistics.successfulPayments": 1 }, $set: { lastSuccessfulPaymentAt: event.payment.createdAt ?? event.occurredAt, "statistics.consecutiveFailures": 0 } });
  const tracked = await trackRecoveryOutcome({ razorpaySubscriptionId: local.razorpaySubscriptionId, payment: event.payment, sourceEventId: String(eventRecordId), observedAt: event.occurredAt });
  if (tracked.newlyRecovered) await Subscription.updateOne({ _id: local._id }, { $inc: { "statistics.recoveredPayments": 1 } });
}

async function handleCancelled(local: InstanceType<typeof Subscription>, event: NormalizedRazorpayEvent): Promise<void> {
  const recoveryCase = await findOpenCase(local._id);
  if (recoveryCase) {
    recoveryCase.status = "STOPPED";
    recoveryCase.closedAt = event.occurredAt;
    recoveryCase.set("outcome.finalReason", "SUBSCRIPTION_CANCELLED");
    await recoveryCase.save();
  }
  await audit({ recoveryCaseId: recoveryCase?._id ?? null, razorpaySubscriptionId: local.razorpaySubscriptionId, eventType: "SUBSCRIPTION_CANCELLED", title: "Subscription cancelled", metadata: { status: "cancelled" }, occurredAt: event.occurredAt });
}

export async function processRazorpayWebhook(eventRecordId: Types.ObjectId, event: NormalizedRazorpayEvent): Promise<"PROCESSED" | "IGNORED"> {
  if (!HANDLED_RAZORPAY_EVENTS.includes(event.eventType as (typeof HANDLED_RAZORPAY_EVENTS)[number])) return "IGNORED";
  if (event.eventType === "payment.failed") return handlePaymentFailed(eventRecordId, event);
  if (!event.subscription) return "IGNORED";
  const local = await Subscription.findOne({ razorpaySubscriptionId: event.subscription.id });
  await audit({ razorpaySubscriptionId: event.subscription.id, eventType: "WEBHOOK_RECEIVED", title: "Razorpay webhook received", metadata: { eventType: event.eventType }, occurredAt: event.occurredAt });
  if (!local) return "IGNORED";
  const applied = await updateLocalLifecycle(local, event.subscription, event);
  if (!applied) return "IGNORED";
  switch (event.eventType) {
    case "subscription.pending": await handleFailure(eventRecordId, local, event, false); break;
    case "subscription.halted": await handleFailure(eventRecordId, local, event, true); break;
    case "subscription.charged": await handleCharged(eventRecordId, local, event); break;
    case "subscription.activated": await audit({ razorpaySubscriptionId: local.razorpaySubscriptionId, eventType: "SUBSCRIPTION_ACTIVATED", title: "Subscription activated", metadata: { status: local.status }, occurredAt: event.occurredAt }); break;
    case "subscription.cancelled": await handleCancelled(local, event); break;
    default: throw new AppError(500, "Unsupported webhook dispatch state.");
  }
  return "PROCESSED";
}
