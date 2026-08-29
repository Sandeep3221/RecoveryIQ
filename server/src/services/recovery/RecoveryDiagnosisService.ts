import { isValidObjectId } from "mongoose";
import { FAILURE_CLASSIFICATION_VERSION } from "../../config/failureClassification.js";
import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import { AuditEvent } from "../../models/AuditEvent.js";
import { FailureEvent } from "../../models/FailureEvent.js";
import { RecoveryCase } from "../../models/RecoveryCase.js";
import { Subscription } from "../../models/Subscription.js";
import { AppError } from "../../utils/AppError.js";
import { failureClassifier, type FailureClassification } from "../classifier/FailureClassifier.js";
import { razorpayDowntimeService, type DowntimeContext } from "../razorpay/RazorpayDowntimeService.js";
import { buildRecoveryContext } from "./RecoveryContextBuilder.js";

export interface RecoveryDiagnosisResult {
  case: InstanceType<typeof RecoveryCase>;
  classification: FailureClassification;
  downtime: DowntimeContext;
  context: RecoveryContext;
}

async function auditOnce(caseId: InstanceType<typeof RecoveryCase>["_id"], subscriptionId: string, eventType: "FAILURE_CLASSIFIED" | "DOWNTIME_CHECKED" | "CONTEXT_BUILT", title: string, metadata: Record<string, unknown>, occurredAt: Date): Promise<void> {
  await AuditEvent.findOneAndUpdate(
    { recoveryCaseId: caseId, eventType },
    { $set: { razorpaySubscriptionId: subscriptionId, actor: "SYSTEM", title, metadata, occurredAt }, $setOnInsert: { recoveryCaseId: caseId, eventType } },
    { upsert: true },
  );
}

export async function diagnoseRecoveryCase(caseId: string, now = new Date()): Promise<RecoveryDiagnosisResult> {
  if (!isValidObjectId(caseId)) throw new AppError(400, "Invalid recovery case ID.");
  const recoveryCase = await RecoveryCase.findById(caseId);
  if (!recoveryCase) throw new AppError(404, "Recovery case not found.");
  if (recoveryCase.status === "RECOVERED" || recoveryCase.status === "STOPPED" || recoveryCase.status === "EXHAUSTED" || recoveryCase.closedAt) throw new AppError(409, "Closed recovery cases cannot be diagnosed.");
  if (recoveryCase.status !== "DETECTED" && recoveryCase.status !== "DIAGNOSED" && recoveryCase.status !== "DECIDED" && recoveryCase.status !== "ACTION_PENDING" && recoveryCase.status !== "ACTION_EXECUTED") throw new AppError(409, "Recovery case is not eligible for diagnosis.");
  const subscription = await Subscription.findById(recoveryCase.subscriptionId);
  if (!subscription) throw new AppError(404, "Recovery case subscription not found.");
  const failures = await FailureEvent.find({ _id: { $in: recoveryCase.failureEventIds } }).sort({ occurredAt: -1 });
  const latestFailure = failures[0] ?? null;
  const classification = failureClassifier.classify({
    reason: latestFailure?.razorpayError?.reason ?? null,
    source: latestFailure?.razorpayError?.source ?? null,
    step: latestFailure?.razorpayError?.step ?? null,
    code: latestFailure?.razorpayError?.code ?? null,
    paymentMethod: latestFailure?.paymentMethod ?? "unknown",
  });
  const classifiedAt = now;
  if (latestFailure) {
    latestFailure.normalizedCategory = classification.category;
    latestFailure.classification = { version: FAILURE_CLASSIFICATION_VERSION, confidence: classification.confidence, matchedBy: classification.matchedBy, matchedRule: classification.matchedRule, explanation: classification.explanation, classifiedAt };
  }
  const downtime = await razorpayDowntimeService.getContext(latestFailure?.paymentMethod ?? "unknown", now);
  if (latestFailure) {
    latestFailure.downtimeSnapshot = { checked: downtime.checked, active: downtime.active, matched: downtime.matched, matchLevel: downtime.matchLevel, method: downtime.method, severity: downtime.severity, downtimeId: downtime.downtimeId, checkedAt: downtime.checkedAt, explanation: downtime.explanation };
    await latestFailure.save();
  }
  const context = buildRecoveryContext({
    caseId: recoveryCase.id,
    openedAt: recoveryCase.openedAt,
    revenueAtRiskMinor: recoveryCase.revenueAtRiskMinor,
    subscription: {
      id: subscription.id, status: subscription.status, amountMinor: subscription.plan?.amountMinor ?? recoveryCase.revenueAtRiskMinor,
      razorpayCreatedAt: subscription.razorpayCreatedAt ?? null, createdAt: subscription.createdAt,
      successfulPayments: subscription.statistics?.successfulPayments ?? 0, failedPayments: subscription.statistics?.failedPayments ?? 0,
      recoveredPayments: subscription.statistics?.recoveredPayments ?? 0, consecutiveFailures: subscription.statistics?.consecutiveFailures ?? 0,
      nudgesSent: subscription.statistics?.nudgesSent ?? 0, lastNudgeAt: subscription.lastNudgeAt ?? null,
    },
    failures: failures.map((failure) => ({ id: failure.id })),
    latestFailure: latestFailure ? { category: classification.category, reason: latestFailure.razorpayError?.reason ?? null, source: latestFailure.razorpayError?.source ?? null, step: latestFailure.razorpayError?.step ?? null, paymentMethod: latestFailure.paymentMethod } : null,
    classification,
    downtime,
    actions: recoveryCase.actions,
    now,
  });
  recoveryCase.latestContext = context;
  recoveryCase.set("latestScores", null);
  recoveryCase.set("latestDecision", null);
  for (const action of recoveryCase.actions) if (action.status === "PENDING") { action.status = "CANCELLED"; action.metadata = { ...(action.metadata ?? {}), cancellationReason: "NEW_FAILURE_CONTEXT" }; }
  recoveryCase.status = "DIAGNOSED";
  await recoveryCase.save();
  await auditOnce(recoveryCase._id, recoveryCase.razorpaySubscriptionId, "FAILURE_CLASSIFIED", "Failure classified deterministically", { category: classification.category, confidence: classification.confidence, classifierVersion: FAILURE_CLASSIFICATION_VERSION }, now);
  await auditOnce(recoveryCase._id, recoveryCase.razorpaySubscriptionId, "DOWNTIME_CHECKED", "Razorpay downtime context checked", { checked: downtime.checked, matchLevel: downtime.matchLevel, active: downtime.active }, now);
  await auditOnce(recoveryCase._id, recoveryCase.razorpaySubscriptionId, "CONTEXT_BUILT", "Recovery context built", { classifierVersion: FAILURE_CLASSIFICATION_VERSION }, now);
  return { case: recoveryCase, classification, downtime, context };
}
