export type SystemReadiness = "checking" | "online" | "offline";

export interface CloudDeskPlan {
  key: "starter" | "pro" | "business";
  razorpayPlanId: string;
  name: string;
  amountMinor: number;
  currency: "INR";
  period: "monthly";
  interval: number;
}

export interface LocalSubscription {
  _id: string;
  razorpaySubscriptionId: string;
  razorpayPlanId: string | null;
  razorpayCustomerId: string | null;
  customer: { name: string; email: string; contact?: string };
  plan: { name: string; amountMinor: number; currency: "INR" };
  status: string;
  authentication?: { paymentId: string | null; verifiedAt: string | null };
  lastFailureAt?: string | null;
  openRecoveryCase?: boolean;
  createdAt: string;
}

export interface LocalRecoveryCase {
  _id: string;
  status: string;
  openedAt: string;
  revenueAtRiskMinor: number;
  subscriptionId: {
    customer: { name: string; email: string };
    plan: { name: string; amountMinor: number; currency: "INR" };
  } | null;
  latestContext?: RecoveryContextView | null;
  latestScores?: RecoveryScoresView | null;
  latestDecision?: RecoveryDecisionView | null;
  actions?: RecoveryActionView[];
  outcome?: RecoveryOutcomeView | null;
}

export type RecoveryActionTypeView = "WAIT_NATIVE_RETRY" | "SEND_NUDGE" | "REQUEST_CARD_UPDATE" | "STOP_AND_ESCALATE";
export interface RecoveryScoreView { action: RecoveryActionTypeView; probability: number; expectedRecoveredMinor: number; scorerVersion: string; datasetVersion?: string | null; explanation: string }
export interface RecoveryScoresView { scorerVersion: string; datasetVersion?: string | null; generatedAt: string; scores: RecoveryScoreView[] }
export interface BlockedRecoveryActionView { action: RecoveryActionTypeView; reasonCode: string; explanation: string }
export interface RecoveryDecisionView {
  policyVersion: string; scorerVersion: string; selectedAction: RecoveryActionTypeView; selectedProbability: number;
  expectedRecoveredMinor: number; reasonCode: string; explanation: string; hardRuleApplied: boolean;
  allowedActions: RecoveryActionTypeView[]; blockedActions: BlockedRecoveryActionView[]; decidedAt: string;
}
export interface RecoveryActionView { actionId: string; decisionId: string; type: RecoveryActionTypeView; status: "PENDING" | "EXECUTED" | "FAILED" | "CANCELLED"; createdAt: string; executedAt: string | null; failedAt: string | null; failureReason: string | null; executionMode: string; metadata: Record<string, unknown> }
export interface RecoveryOutcomeView { outcomeId: string; status: "RECOVERED" | "UNRESOLVED"; observedAt: string; recoveredAt: string | null; recoveredAmountMinor: number; remainingRiskMinor: number; razorpayPaymentId: string | null; razorpayInvoiceId: string | null; matchLevel: "EXACT_INVOICE" | "SUBSCRIPTION_ONLY" | "NONE"; caseMatchConfidence: "HIGH" | "MEDIUM" | "LOW"; actionAtRecovery: RecoveryActionTypeView | null; actionAssociation: "POST_ACTION_ASSOCIATION" | "CARD_UPDATE_SEQUENCE" | "NO_ACTION_ASSOCIATION" | "UNATTRIBUTED"; actionAssociationConfidence: "HIGH" | "MEDIUM" | "LOW" | "NONE"; timeToRecoveryHours: number | null; recoveredWithin7Days: boolean | null; explanation: string }
export interface RecoveryMetricsView { totalCases: number; totalRevenueAtRiskMinor: number; recoveredCases: number; observedRecoveredRevenueMinor: number; unresolvedRevenueMinor: number; caseRecoveryRate: number; revenueRecoveryRate: number; averageTimeToRecoveryHours: number | null; recoveredWithin7DaysCount: number }

export interface FailureEvidenceView {
  _id: string;
  normalizedCategory: string;
  paymentMethod: string;
  razorpayError: { code: string | null; reason: string | null; source: string | null; step: string | null; description?: string | null };
  classification?: { version: string | null; confidence: "HIGH" | "MEDIUM" | "LOW" | null; matchedBy: string | null; matchedRule: string | null; explanation: string | null; classifiedAt: string | null };
  downtimeSnapshot?: { checked: boolean; active: boolean; matched: boolean; matchLevel: "EXACT" | "METHOD_ONLY" | "NONE" | "UNKNOWN"; method: string | null; severity: "low" | "medium" | "high" | null; downtimeId: string | null; checkedAt: string | null; explanation: string | null };
}

export interface RecoveryContextView {
  subscription: { id: string; status: string; amountMinor: number; ageDays: number; nativeRetryPossible: boolean };
  failure: { category: string; reason: string | null; source: string | null; step: string | null; paymentMethod: string; failureCount: number; consecutiveFailureCount: number };
  diagnosis: { classifierVersion: string; confidence: "HIGH" | "MEDIUM" | "LOW"; explanation: string };
  downtime: { checked: boolean; active: boolean; method: string | null; severity: "low" | "medium" | "high" | null; matchLevel: "EXACT" | "METHOD_ONLY" | "NONE" | "UNKNOWN" };
  customerHistory: { previousSuccessfulPayments: number; previousFailedPayments: number; previousRecoveredPayments: number; previousRecoveryRate: number; previousNudges: number; hoursSinceLastNudge: number | null };
  caseState: { caseAgeHours: number; revenueAtRiskMinor?: number; previousActions: string[] };
}

export interface RecoveryCaseDetail extends Omit<LocalRecoveryCase, "subscriptionId"> {
  subscriptionId: {
    customer: { name: string; email: string };
    plan: { name: string; amountMinor: number; currency: "INR" };
    status: string;
    razorpaySubscriptionId: string;
  } | null;
}

export interface AuditEventView { _id: string; eventType: string; title: string; actor: string; occurredAt: string }

export interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  subscription_card_change?: boolean;
  prefill?: { name: string; email: string; contact?: string };
  handler: (response: RazorpayCheckoutResponse) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}
