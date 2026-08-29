import type { RecoveryDecision } from "../../domain/recovery/RecoveryDecision.js";
import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import { RECOVERY_ACTION_TYPES, type PolicyReasonCode, type RecoveryActionType } from "../../domain/types.js";
import type { RecoveryScore } from "../scorer/RecoveryScorer.js";

export interface RecoveryPolicyConfig {
  version: string;
  maxNudgesPerCase: number;
  minimumNudgeCooldownHours: number;
  maxCaseAgeHours: number;
  maxUnknownFailuresBeforeStop: number;
}

export interface RecoveryPolicyInput {
  context: RecoveryContext;
  scores: RecoveryScore[];
  policyConfig: RecoveryPolicyConfig;
  decidedAt?: Date;
}

type Block = RecoveryDecision["blockedActions"][number];

function hardDecision(input: RecoveryPolicyInput, action: RecoveryActionType, reasonCode: PolicyReasonCode, explanation: string): RecoveryDecision {
  const selected = input.scores.find((score) => score.action === action)!;
  return {
    policyVersion: input.policyConfig.version, scorerVersion: selected.scorerVersion, selectedAction: action,
    selectedProbability: selected.probability, expectedRecoveredMinor: selected.expectedRecoveredMinor,
    reasonCode, explanation, hardRuleApplied: true, allowedActions: [action],
    blockedActions: RECOVERY_ACTION_TYPES.filter((candidate) => candidate !== action).map((candidate) => ({ action: candidate, reasonCode, explanation: `Blocked because ${reasonCode} deterministically selected ${action}.` })),
    decidedAt: input.decidedAt ?? new Date(),
  };
}

export function evaluateRecoveryPolicy(input: RecoveryPolicyInput): RecoveryDecision {
  const { context, scores, policyConfig } = input;
  const status = context.subscription.status;
  const category = context.failure.category;

  if (status === "cancelled" || status === "completed") return hardDecision(input, "STOP_AND_ESCALATE", "SUBSCRIPTION_TERMINAL", "The subscription is terminal, so RecoveryIQ selected STOP_AND_ESCALATE and excluded recovery interventions.");
  if (context.caseState.caseAgeHours >= policyConfig.maxCaseAgeHours) return hardDecision(input, "STOP_AND_ESCALATE", "CASE_TOO_OLD", `The case reached the RecoveryIQ policy age limit of ${policyConfig.maxCaseAgeHours} hours, so it was selected for escalation.`);
  if (category === "MANDATE_OR_AUTH_INVALID") return hardDecision(input, "STOP_AND_ESCALATE", "MANDATE_INVALID", "The payment mandate or authorization is invalid, so RecoveryIQ selected STOP_AND_ESCALATE without starting a new authorization flow.");
  if (category === "PAYMENT_METHOD_INVALID") return hardDecision(input, "REQUEST_CARD_UPDATE", "PAYMENT_METHOD_REQUIRES_UPDATE", "The payment method is invalid, so REQUEST_CARD_UPDATE is required regardless of higher scores for other actions.");
  if (context.downtime.checked && context.downtime.active && status === "pending") return hardDecision(input, "WAIT_NATIVE_RETRY", "ACTIVE_PAYMENT_DOWNTIME", "Confirmed relevant payment-method downtime is active while the Razorpay subscription remains pending. RecoveryIQ selected WAIT_NATIVE_RETRY to defer unnecessary customer intervention.");
  if (context.downtime.active && status === "halted") return hardDecision(input, "STOP_AND_ESCALATE", "NATIVE_RETRIES_EXHAUSTED", "Relevant payment downtime is active, but the Razorpay subscription is already halted, so no native retry opportunity remains.");

  const allowed = new Set<RecoveryActionType>();
  const blocked = new Map<RecoveryActionType, Block>();
  const block = (action: RecoveryActionType, reasonCode: PolicyReasonCode, explanation: string): void => { blocked.set(action, { action, reasonCode, explanation }); allowed.delete(action); };

  if (status === "halted") block("WAIT_NATIVE_RETRY", "NATIVE_RETRIES_EXHAUSTED", "The Razorpay subscription is halted, so native retry is unavailable.");
  if (context.customerHistory.previousNudges >= policyConfig.maxNudgesPerCase) block("SEND_NUDGE", "NUDGE_LIMIT_REACHED", "The RecoveryIQ merchant-policy nudge limit has been reached.");
  else if (context.customerHistory.hoursSinceLastNudge !== null && context.customerHistory.hoursSinceLastNudge < policyConfig.minimumNudgeCooldownHours) block("SEND_NUDGE", "NUDGE_COOLDOWN_ACTIVE", "The RecoveryIQ merchant-policy nudge cooldown is still active.");

  if (category === "UNKNOWN" && context.failure.consecutiveFailureCount >= policyConfig.maxUnknownFailuresBeforeStop) return hardDecision(input, "STOP_AND_ESCALATE", "REPEATED_UNKNOWN_FAILURE", "Repeated unexplained failures reached the RecoveryIQ policy threshold, so the case was selected for escalation.");
  if (category === "UNKNOWN" && status === "pending" && context.subscription.nativeRetryPossible) return hardDecision(input, "WAIT_NATIVE_RETRY", "NATIVE_RETRY_AVAILABLE", "This is an ambiguous failure while the subscription remains pending and native retry is available, so RecoveryIQ selected WAIT_NATIVE_RETRY.");

  if (category === "TEMPORARY_FUNDS" || category === "BANK_OR_NETWORK") {
    if (status === "pending" && context.subscription.nativeRetryPossible) allowed.add("WAIT_NATIVE_RETRY");
    if (!blocked.has("SEND_NUDGE")) allowed.add("SEND_NUDGE");
    allowed.add("STOP_AND_ESCALATE");
    block("REQUEST_CARD_UPDATE", "TRANSIENT_FAILURE", "A card update is not appropriate for a transient funds, bank, or network failure.");
  } else if (category === "CUSTOMER_AUTH_FAILURE") {
    if (context.subscription.nativeRetryPossible && status !== "halted") allowed.add("WAIT_NATIVE_RETRY");
    if (!blocked.has("SEND_NUDGE")) allowed.add("SEND_NUDGE");
    allowed.add("STOP_AND_ESCALATE");
    block("REQUEST_CARD_UPDATE", "CUSTOMER_ACTION_HELPFUL", "Authentication failure does not by itself show that the card must be replaced.");
  } else {
    if (!blocked.has("SEND_NUDGE")) allowed.add("SEND_NUDGE");
    allowed.add("STOP_AND_ESCALATE");
    block("REQUEST_CARD_UPDATE", "MODEL_SELECTED_BEST_ALLOWED_ACTION", "The failure evidence does not establish that a card update is useful.");
  }
  for (const action of RECOVERY_ACTION_TYPES) if (!allowed.has(action) && !blocked.has(action)) block(action, action === "WAIT_NATIVE_RETRY" ? "NATIVE_RETRIES_EXHAUSTED" : "MODEL_SELECTED_BEST_ALLOWED_ACTION", "The action is not eligible for this recovery context.");
  const ranked = scores.filter((score) => allowed.has(score.action)).sort((a, b) => b.probability - a.probability || RECOVERY_ACTION_TYPES.indexOf(a.action) - RECOVERY_ACTION_TYPES.indexOf(b.action));
  const selected = ranked[0]!;
  const customerHelpful = category === "CUSTOMER_AUTH_FAILURE" && selected.action === "SEND_NUDGE";
  return {
    policyVersion: policyConfig.version, scorerVersion: selected.scorerVersion, selectedAction: selected.action,
    selectedProbability: selected.probability, expectedRecoveredMinor: selected.expectedRecoveredMinor,
    reasonCode: customerHelpful ? "CUSTOMER_ACTION_HELPFUL" : "MODEL_SELECTED_BEST_ALLOWED_ACTION",
    explanation: customerHelpful ? "Customer authentication failed, and the permitted customer nudge ranked highest, so RecoveryIQ selected SEND_NUDGE." : `No hard policy rule determined one action. ${selected.scorerVersion} ranked ${selected.action} highest among the permitted actions.`,
    hardRuleApplied: false, allowedActions: RECOVERY_ACTION_TYPES.filter((action) => allowed.has(action)),
    blockedActions: RECOVERY_ACTION_TYPES.flatMap((action) => blocked.has(action) ? [blocked.get(action)!] : []), decidedAt: input.decidedAt ?? new Date(),
  };
}
