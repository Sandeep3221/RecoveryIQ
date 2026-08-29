import {
  BASE_RECOVERY_PROBABILITIES,
  HEURISTIC_SCORER_VERSION,
  MAX_RECOVERY_PROBABILITY,
  MIN_RECOVERY_PROBABILITY,
  RECOVERY_SCORE_ADJUSTMENTS,
} from "../../config/recoveryScoring.js";
import { RECOVERY_ACTION_TYPES, type RecoveryActionType } from "../../domain/types.js";
import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import type { RecoveryScore, RecoveryScorer } from "./RecoveryScorer.js";

interface Adjustment { amount: number; reason: string }

function roundProbability(value: number): number {
  return Math.round(Math.min(MAX_RECOVERY_PROBABILITY, Math.max(MIN_RECOVERY_PROBABILITY, value)) * 100) / 100;
}

function signed(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }

function adjustmentsFor(action: RecoveryActionType, context: RecoveryContext): Adjustment[] {
  const adjustments: Adjustment[] = [];
  if (action === "WAIT_NATIVE_RETRY") adjustments.push(context.subscription.nativeRetryPossible
    ? { amount: RECOVERY_SCORE_ADJUSTMENTS.nativeRetryAvailable, reason: "Razorpay native retry remains available" }
    : { amount: RECOVERY_SCORE_ADJUSTMENTS.nativeRetryUnavailable, reason: "Razorpay native retry is unavailable" });
  if (context.downtime.active) {
    const amount = RECOVERY_SCORE_ADJUSTMENTS.activeDowntime[action as keyof typeof RECOVERY_SCORE_ADJUSTMENTS.activeDowntime];
    if (amount !== undefined) adjustments.push({ amount, reason: "confirmed relevant payment-method downtime is active" });
  }
  if (context.failure.failureCount >= 3) {
    const amount = RECOVERY_SCORE_ADJUSTMENTS.repeatedFailure[action as keyof typeof RECOVERY_SCORE_ADJUSTMENTS.repeatedFailure];
    if (amount !== undefined) adjustments.push({ amount, reason: "the case has at least three unique failures" });
  }
  if (context.customerHistory.previousRecoveryRate >= 0.5) {
    const amount = RECOVERY_SCORE_ADJUSTMENTS.strongRecoveryHistory[action as keyof typeof RECOVERY_SCORE_ADJUSTMENTS.strongRecoveryHistory];
    if (amount !== undefined) adjustments.push({ amount, reason: "historical recovery rate is at least 50%" });
  }
  if (action === "SEND_NUDGE" && context.customerHistory.previousNudges >= 2) adjustments.push({ amount: RECOVERY_SCORE_ADJUSTMENTS.nudgeLimitReached, reason: "at least two nudges were previously sent" });
  if (context.subscription.status === "halted") {
    const amount = RECOVERY_SCORE_ADJUSTMENTS.halted[action as keyof typeof RECOVERY_SCORE_ADJUSTMENTS.halted];
    if (amount !== undefined) adjustments.push({ amount, reason: "the Razorpay subscription is halted" });
  }
  if (context.diagnosis.confidence === "LOW") {
    const amount = RECOVERY_SCORE_ADJUSTMENTS.lowDiagnosisConfidence[action as keyof typeof RECOVERY_SCORE_ADJUSTMENTS.lowDiagnosisConfidence];
    if (amount !== undefined) adjustments.push({ amount, reason: "diagnosis confidence is LOW" });
  }
  return adjustments;
}

export class HeuristicRecoveryScorer implements RecoveryScorer {
  score(context: RecoveryContext): RecoveryScore[] {
    const baseScores = BASE_RECOVERY_PROBABILITIES[context.failure.category];
    return RECOVERY_ACTION_TYPES.map((action) => {
      const base = baseScores[action];
      const adjustments = adjustmentsFor(action, context);
      const probability = roundProbability(base + adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0));
      const clauses = [`Base ${context.failure.category} score ${base.toFixed(2)}`];
      clauses.push(...adjustments.map((adjustment) => `${signed(adjustment.amount)} because ${adjustment.reason}`));
      return {
        action,
        probability,
        expectedRecoveredMinor: Math.round(probability * context.caseState.revenueAtRiskMinor),
        scorerVersion: HEURISTIC_SCORER_VERSION,
        explanation: `${clauses.join("; ")}.`,
      };
    });
  }
}

export const heuristicRecoveryScorer = new HeuristicRecoveryScorer();
