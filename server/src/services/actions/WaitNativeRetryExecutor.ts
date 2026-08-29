import type { ActionExecutionResult, RecoveryActionExecutionInput, RecoveryActionExecutor } from "./RecoveryActionExecutor.js";

export class WaitNativeRetryExecutor implements RecoveryActionExecutor {
  async execute(input: RecoveryActionExecutionInput): Promise<ActionExecutionResult> {
    return { status: "EXECUTED", executedAt: input.now, failureReason: null, executionMode: "internal", metadata: { retryOwner: "razorpay", customRetryScheduled: false, explanation: "RecoveryIQ is deferring customer intervention because Razorpay reports a pending subscription with native retry opportunity." } };
  }
}
