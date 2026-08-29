import { RECOVERY_ACTION_TYPES, type RecoveryActionType, type SubscriptionStatus } from "../../domain/types.js";
import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import type { FailureClassification } from "../classifier/FailureClassifier.js";
import type { DowntimeContext } from "../razorpay/RazorpayDowntimeService.js";
import { FAILURE_CLASSIFICATION_VERSION } from "../../config/failureClassification.js";

export interface RecoveryContextBuilderInput {
  caseId: string;
  openedAt: Date;
  revenueAtRiskMinor: number;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    amountMinor: number;
    razorpayCreatedAt: Date | null;
    createdAt: Date;
    successfulPayments: number;
    failedPayments: number;
    recoveredPayments: number;
    consecutiveFailures: number;
    nudgesSent: number;
    lastNudgeAt: Date | null;
  };
  failures: Array<{ id: string }>;
  latestFailure: { category: RecoveryContext["failure"]["category"]; reason: string | null; source: string | null; step: string | null; paymentMethod: string } | null;
  classification: FailureClassification;
  downtime: DowntimeContext;
  actions: Array<{ type?: string | null }>;
  now?: Date;
}

function elapsedHours(from: Date, to: Date): number { return Math.max(0, Number(((to.getTime() - from.getTime()) / 3_600_000).toFixed(2))); }

export function buildRecoveryContext(input: RecoveryContextBuilderInput): RecoveryContext {
  const now = input.now ?? new Date();
  const subscriptionCreatedAt = input.subscription.razorpayCreatedAt ?? input.subscription.createdAt;
  const failed = input.subscription.failedPayments;
  const previousActions = input.actions.flatMap((action) => RECOVERY_ACTION_TYPES.includes(action.type as RecoveryActionType) ? [action.type as RecoveryActionType] : []);
  return {
    generatedAt: now,
    caseId: input.caseId,
    subscription: {
      id: input.subscription.id,
      status: input.subscription.status,
      amountMinor: input.subscription.amountMinor,
      ageDays: Math.max(0, Math.floor((now.getTime() - subscriptionCreatedAt.getTime()) / 86_400_000)),
      nativeRetryPossible: input.subscription.status === "pending",
    },
    failure: {
      category: input.classification.category,
      reason: input.latestFailure?.reason ?? null,
      source: input.latestFailure?.source ?? null,
      step: input.latestFailure?.step ?? null,
      paymentMethod: input.latestFailure?.paymentMethod ?? "unknown",
      failureCount: new Set(input.failures.map((failure) => failure.id)).size,
      consecutiveFailureCount: input.subscription.consecutiveFailures,
    },
    customerHistory: {
      previousSuccessfulPayments: input.subscription.successfulPayments,
      previousFailedPayments: failed,
      previousRecoveredPayments: input.subscription.recoveredPayments,
      previousRecoveryRate: failed > 0 ? Math.min(1, input.subscription.recoveredPayments / failed) : 0,
      previousNudges: input.subscription.nudgesSent,
      hoursSinceLastNudge: input.subscription.lastNudgeAt ? elapsedHours(input.subscription.lastNudgeAt, now) : null,
    },
    diagnosis: { classifierVersion: FAILURE_CLASSIFICATION_VERSION, confidence: input.classification.confidence, explanation: input.classification.explanation },
    downtime: { checked: input.downtime.checked, active: input.downtime.active, method: input.downtime.method, severity: input.downtime.severity, matchLevel: input.downtime.matchLevel },
    caseState: { caseAgeHours: elapsedHours(input.openedAt, now), revenueAtRiskMinor: input.revenueAtRiskMinor, previousActions },
  };
}
