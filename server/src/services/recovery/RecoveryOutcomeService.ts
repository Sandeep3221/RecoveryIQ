import { createHash } from "node:crypto";
import type { Types } from "mongoose";
import type { RecoveryOutcome, RecoveryMatchLevel } from "../../domain/recovery/RecoveryOutcome.js";
import type { RecoveryActionType } from "../../domain/types.js";
import { AuditEvent } from "../../models/AuditEvent.js";
import { FailureEvent } from "../../models/FailureEvent.js";
import { RecoveryCase } from "../../models/RecoveryCase.js";
import { Subscription } from "../../models/Subscription.js";
import type { NormalizedRazorpayPayment } from "../razorpay/RazorpayEventNormalizer.js";

const ASSOCIATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FALLBACK_STATUSES = ["DETECTED", "DIAGNOSED", "DECIDED", "ACTION_PENDING", "ACTION_EXECUTED"] as const;
type CaseDocument = InstanceType<typeof RecoveryCase>;
type StoredAction = CaseDocument["actions"][number];
export interface RecoveryOutcomeTrackingInput { razorpaySubscriptionId: string; payment: NormalizedRazorpayPayment | null; sourceEventId: string; observedAt: Date; }
export interface RecoveryOutcomeTrackingResult { matched: boolean; newlyRecovered: boolean; matchLevel: RecoveryMatchLevel; recoveryCaseId: string | null; outcome: RecoveryOutcome | null; }

function outcomeId(caseId: string, paymentId: string): string { return `outcome_${createHash("sha256").update(`${caseId}|${paymentId}`).digest("hex")}`; }
function timing(anchor: Date, recoveredAt: Date): { hours: number | null; within: boolean | null } {
  const milliseconds = recoveredAt.getTime() - anchor.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return { hours: null, within: null };
  const hours = Number((milliseconds / 3_600_000).toFixed(4)); return { hours, within: hours <= 168 };
}
function executedAction(recoveryCase: CaseDocument, recoveredAt: Date): StoredAction | null {
  return recoveryCase.actions.filter((action) => action.status === "EXECUTED" && action.executedAt && action.executedAt <= recoveredAt).sort((a, b) => b.executedAt!.getTime() - a.executedAt!.getTime())[0] ?? null;
}
function association(action: StoredAction | null): Pick<RecoveryOutcome, "actionAtRecovery" | "actionAssociation" | "actionAssociationConfidence" | "explanation"> {
  if (!action) return { actionAtRecovery: null, actionAssociation: "NO_ACTION_ASSOCIATION", actionAssociationConfidence: "NONE", explanation: "Razorpay confirmed a successful subscription charge before any RecoveryIQ action was executed." };
  const type = action.type as RecoveryActionType;
  if (type === "WAIT_NATIVE_RETRY") return { actionAtRecovery: type, actionAssociation: "POST_ACTION_ASSOCIATION", actionAssociationConfidence: "MEDIUM", explanation: "A successful Razorpay subscription charge was observed after RecoveryIQ executed WAIT_NATIVE_RETRY. The webhook proves recovery but does not prove whether an automatic Razorpay retry or another valid payment attempt initiated the charge." };
  if (type === "SEND_NUDGE" && action.metadata?.customerContacted === true) return { actionAtRecovery: type, actionAssociation: "POST_ACTION_ASSOCIATION", actionAssociationConfidence: "LOW", explanation: "A successful Razorpay subscription charge was observed after a confirmed live nudge. The temporal sequence does not prove that the nudge caused recovery." };
  if (type === "REQUEST_CARD_UPDATE" && action.metadata?.cardUpdateCompleted === true) return { actionAtRecovery: type, actionAssociation: "CARD_UPDATE_SEQUENCE", actionAssociationConfidence: "HIGH", explanation: "The authoritative successful charge followed verified card-update completion and is strongly associated with that sequence, without asserting causal uplift." };
  if (type === "SEND_NUDGE") return { actionAtRecovery: type, actionAssociation: "UNATTRIBUTED", actionAssociationConfidence: "NONE", explanation: "The nudge action did not confirm customer contact, so the later successful charge is not credited to the simulated delivery." };
  return { actionAtRecovery: type, actionAssociation: "UNATTRIBUTED", actionAssociationConfidence: "NONE", explanation: "Razorpay confirmed recovery after an operational action that is not credited with collecting the payment." };
}
async function correlate(subscriptionObjectId: Types.ObjectId, invoiceId: string | null, recoveredAt: Date): Promise<{ recoveryCase: CaseDocument | null; matchLevel: RecoveryMatchLevel }> {
  if (invoiceId) {
    const failures = await FailureEvent.find({ razorpayInvoiceId: invoiceId, razorpaySubscriptionId: { $exists: true } }).select("_id");
    if (failures.length) {
      const exact = await RecoveryCase.find({ subscriptionId: subscriptionObjectId, failureEventIds: { $in: failures.map((failure) => failure._id) }, openedAt: { $lte: recoveredAt } });
      if (exact.length === 1) return { recoveryCase: exact[0]!, matchLevel: "EXACT_INVOICE" };
    }
  }
  const candidates = await RecoveryCase.find({ subscriptionId: subscriptionObjectId, status: { $in: FALLBACK_STATUSES }, openedAt: { $lte: recoveredAt, $gte: new Date(recoveredAt.getTime() - ASSOCIATION_WINDOW_MS) } });
  return candidates.length === 1 ? { recoveryCase: candidates[0]!, matchLevel: "SUBSCRIPTION_ONLY" } : { recoveryCase: null, matchLevel: "NONE" };
}
async function unmatched(input: RecoveryOutcomeTrackingInput, reason: string): Promise<RecoveryOutcomeTrackingResult> {
  await AuditEvent.findOneAndUpdate({ eventType: "RECOVERY_SUCCESS_UNMATCHED", "metadata.paymentId": input.payment?.id }, { $set: { recoveryCaseId: null, razorpaySubscriptionId: input.razorpaySubscriptionId, actor: "SYSTEM", title: "Successful subscription charge could not be safely matched", metadata: { paymentId: input.payment?.id, invoiceId: input.payment?.invoiceId, reason }, occurredAt: input.observedAt }, $setOnInsert: { eventType: "RECOVERY_SUCCESS_UNMATCHED" } }, { upsert: true });
  return { matched: false, newlyRecovered: false, matchLevel: "NONE", recoveryCaseId: null, outcome: null };
}

export async function trackRecoveryOutcome(input: RecoveryOutcomeTrackingInput): Promise<RecoveryOutcomeTrackingResult> {
  const payment = input.payment;
  if (!payment?.id || payment.status !== "captured" || payment.currency !== "INR" || payment.amountMinor === null || !Number.isInteger(payment.amountMinor) || payment.amountMinor < 0) return unmatched(input, "Payment evidence was not a valid captured INR payment.");
  const prior = await RecoveryCase.findOne({ "outcome.status": "RECOVERED", "outcome.razorpayPaymentId": payment.id });
  if (prior) return { matched: true, newlyRecovered: false, matchLevel: prior.outcome?.matchLevel as RecoveryMatchLevel, recoveryCaseId: prior.id, outcome: prior.outcome as unknown as RecoveryOutcome };
  const subscription = await Subscription.findOne({ razorpaySubscriptionId: input.razorpaySubscriptionId });
  if (!subscription) return unmatched(input, "No tracked subscription matched the successful charge.");
  const recoveredAt = payment.createdAt ?? input.observedAt;
  const correlated = await correlate(subscription._id, payment.invoiceId, recoveredAt);
  if (!correlated.recoveryCase) return unmatched(input, "No unique eligible RecoveryCase could be correlated.");
  const recoveryCase = correlated.recoveryCase;
  if (recoveryCase.outcome?.status === "RECOVERED") return { matched: true, newlyRecovered: false, matchLevel: correlated.matchLevel, recoveryCaseId: recoveryCase.id, outcome: recoveryCase.outcome as unknown as RecoveryOutcome };
  if ((recoveryCase.status === "STOPPED" || recoveryCase.status === "EXHAUSTED") && correlated.matchLevel !== "EXACT_INVOICE") return unmatched(input, "Closed cases require exact invoice correlation.");
  const action = executedAction(recoveryCase, recoveredAt); const actionAssociation = association(action); const anchor = action?.executedAt ?? recoveryCase.openedAt; const elapsed = timing(anchor, recoveredAt);
  const recoveredAmountMinor = Math.min(payment.amountMinor, recoveryCase.revenueAtRiskMinor); const remainingRiskMinor = Math.max(recoveryCase.revenueAtRiskMinor - recoveredAmountMinor, 0);
  const outcome: RecoveryOutcome = { outcomeId: outcomeId(recoveryCase.id, payment.id), status: "RECOVERED", observedAt: input.observedAt, recoveredAt, recoveredAmountMinor, remainingRiskMinor, razorpayPaymentId: payment.id, razorpayInvoiceId: payment.invoiceId, sourceEventId: input.sourceEventId, matchLevel: correlated.matchLevel, caseMatchConfidence: correlated.matchLevel === "EXACT_INVOICE" ? "HIGH" : "MEDIUM", ...actionAssociation, timeToRecoveryHours: elapsed.hours, recoveredWithin7Days: elapsed.within, payment: { paymentId: payment.id, invoiceId: payment.invoiceId, amountMinor: payment.amountMinor, currency: "INR", status: "captured", method: payment.method, createdAt: payment.createdAt } };
  const update = await RecoveryCase.updateOne({ _id: recoveryCase._id, "outcome.status": { $ne: "RECOVERED" } }, { $set: { status: "RECOVERED", closedAt: recoveredAt, recoveredAmountMinor, outcome: { ...outcome, recovered: true, recoveredPaymentId: payment.id, nativeRecovery: null, finalReason: "PAYMENT_RECOVERED" } } });
  if (update.modifiedCount === 0) { const current = await RecoveryCase.findById(recoveryCase._id); return { matched: true, newlyRecovered: false, matchLevel: correlated.matchLevel, recoveryCaseId: recoveryCase.id, outcome: current?.outcome as unknown as RecoveryOutcome }; }
  await AuditEvent.findOneAndUpdate({ recoveryCaseId: recoveryCase._id, eventType: "REVENUE_RECOVERED", "metadata.paymentId": payment.id }, { $set: { razorpaySubscriptionId: input.razorpaySubscriptionId, actor: "SYSTEM", title: "Observed recovered revenue recorded", metadata: { amountMinor: recoveredAmountMinor, paymentId: payment.id, invoiceId: payment.invoiceId, matchLevel: correlated.matchLevel, actionAssociation: outcome.actionAssociation, recoveredWithin7Days: outcome.recoveredWithin7Days }, occurredAt: input.observedAt }, $setOnInsert: { recoveryCaseId: recoveryCase._id, eventType: "REVENUE_RECOVERED" } }, { upsert: true });
  return { matched: true, newlyRecovered: true, matchLevel: correlated.matchLevel, recoveryCaseId: recoveryCase.id, outcome };
}
