import type { FailureCategory, RecoveryActionType, SubscriptionStatus } from "../types.js";

export interface RecoveryContext {
  generatedAt?: Date;
  caseId: string;
  subscription: { id: string; status: SubscriptionStatus; amountMinor: number; ageDays: number; nativeRetryPossible: boolean };
  failure: { category: FailureCategory; reason: string | null; source: string | null; step: string | null; paymentMethod: string; failureCount: number; consecutiveFailureCount: number };
  customerHistory: { previousSuccessfulPayments: number; previousFailedPayments: number; previousRecoveredPayments: number; previousRecoveryRate: number; previousNudges: number; hoursSinceLastNudge: number | null };
  diagnosis: { classifierVersion: string; confidence: "HIGH" | "MEDIUM" | "LOW"; explanation: string };
  downtime: { checked: boolean; active: boolean; method: string | null; severity: "low" | "medium" | "high" | null; matchLevel: "EXACT" | "METHOD_ONLY" | "NONE" | "UNKNOWN" };
  caseState: { caseAgeHours: number; revenueAtRiskMinor: number; previousActions: RecoveryActionType[] };
}
