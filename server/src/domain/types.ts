export const SUBSCRIPTION_STATUSES = ["created", "authenticated", "active", "pending", "halted", "cancelled", "completed", "paused", "unknown"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const FAILURE_CATEGORIES = ["TEMPORARY_FUNDS", "PAYMENT_METHOD_INVALID", "BANK_OR_NETWORK", "CUSTOMER_AUTH_FAILURE", "MANDATE_OR_AUTH_INVALID", "UNKNOWN"] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const RECOVERY_ACTION_TYPES = ["WAIT_NATIVE_RETRY", "SEND_NUDGE", "REQUEST_CARD_UPDATE", "STOP_AND_ESCALATE"] as const;
export type RecoveryActionType = (typeof RECOVERY_ACTION_TYPES)[number];

export const RECOVERY_CASE_STATUSES = ["DETECTED", "DIAGNOSED", "DECIDED", "ACTION_PENDING", "ACTION_EXECUTED", "RECOVERED", "STOPPED", "EXHAUSTED"] as const;
export type RecoveryCaseStatus = (typeof RECOVERY_CASE_STATUSES)[number];

export const ACTION_STATUSES = ["PENDING", "EXECUTED", "FAILED", "CANCELLED"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const POLICY_REASON_CODES = ["SUBSCRIPTION_TERMINAL", "MANDATE_INVALID", "PAYMENT_METHOD_REQUIRES_UPDATE", "ACTIVE_PAYMENT_DOWNTIME", "TRANSIENT_FAILURE", "CUSTOMER_ACTION_HELPFUL", "NATIVE_RETRY_AVAILABLE", "NATIVE_RETRIES_EXHAUSTED", "NUDGE_LIMIT_REACHED", "NUDGE_COOLDOWN_ACTIVE", "CASE_TOO_OLD", "REPEATED_UNKNOWN_FAILURE", "MODEL_SELECTED_BEST_ALLOWED_ACTION"] as const;
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

export interface ActionScore {
  action: RecoveryActionType;
  probability: number;
  allowed: boolean;
  expectedValueMinor?: number;
  blockedReason?: string;
}

