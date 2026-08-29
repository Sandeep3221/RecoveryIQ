import type { ActionExecutionResult, RecoveryActionExecutionInput, RecoveryActionExecutor } from "./RecoveryActionExecutor.js";

export class StopAndEscalateExecutor implements RecoveryActionExecutor {
  async execute(input: RecoveryActionExecutionInput): Promise<ActionExecutionResult> {
    return { status: "EXECUTED", executedAt: input.now, failureReason: null, executionMode: "internal", metadata: { escalationTarget: "merchant_review", explanation: "RecoveryIQ stopped automated recovery handling and routed the case for merchant review." } };
  }
}
