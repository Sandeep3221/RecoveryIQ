import { recoveryPolicy } from "../config/recoveryPolicy.js";
import type { RecoveryContext } from "../domain/recovery/RecoveryContext.js";
import type { RecoveryActionType } from "../domain/types.js";

export function naiveRetryFirst(context: RecoveryContext): RecoveryActionType {
  return context.subscription.status === "pending" && context.subscription.nativeRetryPossible
    ? "WAIT_NATIVE_RETRY"
    : "STOP_AND_ESCALATE";
}

export function naiveNudgeFirst(context: RecoveryContext): RecoveryActionType {
  const nudgeAllowed = context.customerHistory.previousNudges < recoveryPolicy.maxNudgesPerCase
    && (context.customerHistory.hoursSinceLastNudge === null
      || context.customerHistory.hoursSinceLastNudge >= recoveryPolicy.minimumNudgeCooldownHours);
  if (nudgeAllowed) return "SEND_NUDGE";
  if (context.subscription.status === "pending" && context.subscription.nativeRetryPossible) return "WAIT_NATIVE_RETRY";
  return "STOP_AND_ESCALATE";
}
