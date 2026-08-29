import type { ActionStatus, RecoveryActionType } from "../../domain/types.js";

export interface RecoveryActionExecutionInput {
  caseId: string; actionId: string; decisionId: string; type: RecoveryActionType; razorpaySubscriptionId: string;
  customer: { name: string; email: string }; plan: { name: string; amountMinor: number; currency: "INR" }; now: Date;
}
export interface ActionExecutionResult {
  status: ActionStatus; executedAt: Date | null; failureReason: string | null;
  executionMode: "internal" | "simulation" | "live" | "customer"; metadata: Record<string, unknown>; recoveryUrl?: string;
}
export interface RecoveryActionExecutor { execute(input: RecoveryActionExecutionInput): Promise<ActionExecutionResult>; }
