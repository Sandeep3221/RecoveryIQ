import { createHash } from "node:crypto";
import { isValidObjectId } from "mongoose";
import type { RecoveryDecision } from "../../domain/recovery/RecoveryDecision.js";
import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import type { RecoveryActionType } from "../../domain/types.js";
import { AuditEvent } from "../../models/AuditEvent.js";
import { RecoveryCase } from "../../models/RecoveryCase.js";
import { Subscription } from "../../models/Subscription.js";
import { AppError } from "../../utils/AppError.js";
import { RequestCardUpdateExecutor } from "../actions/RequestCardUpdateExecutor.js";
import type { ActionExecutionResult, RecoveryActionExecutor } from "../actions/RecoveryActionExecutor.js";
import { SendNudgeExecutor } from "../actions/SendNudgeExecutor.js";
import { StopAndEscalateExecutor } from "../actions/StopAndEscalateExecutor.js";
import { WaitNativeRetryExecutor } from "../actions/WaitNativeRetryExecutor.js";
import { SimulationRecoveryNotificationService, type RecoveryNotificationService } from "../notifications/RecoveryNotificationService.js";
import { recoveryDecisionId } from "./DecisionIdentity.js";

interface StoredAction { actionId: string; decisionId: string; type: RecoveryActionType; status: "PENDING" | "EXECUTED" | "FAILED" | "CANCELLED"; createdAt: Date; executedAt: Date | null; failedAt: Date | null; failureReason: string | null; executionMode: string; metadata: Record<string, unknown>; }
export interface RecoveryExecutionResult { caseId: string; caseStatus: string; action: Omit<StoredAction, "metadata"> & { metadata: Record<string, unknown> }; recoveryUrl?: string; }

function actionIdFor(decisionId: string): string { return `action_${createHash("sha256").update(decisionId).digest("hex")}`; }
function safeAction(action: StoredAction): RecoveryExecutionResult["action"] {
  const metadata = { ...(action.metadata ?? {}) };
  delete metadata.tokenHash;
  return { actionId: action.actionId, decisionId: action.decisionId, type: action.type, status: action.status, createdAt: action.createdAt, executedAt: action.executedAt ?? null, failedAt: action.failedAt ?? null, failureReason: action.failureReason ?? null, executionMode: action.executionMode, metadata };
}
function stale(recoveryCase: InstanceType<typeof RecoveryCase>, decision: RecoveryDecision): boolean {
  const context = recoveryCase.latestContext as RecoveryContext | null;
  const snapshot = recoveryCase.latestScores as unknown as { scorerVersion?: string; generatedAt?: Date; scores?: Array<{ action: string; probability: number; expectedRecoveredMinor: number }> } | null;
  if (!context || !snapshot?.generatedAt || !snapshot.scores || snapshot.scorerVersion !== decision.scorerVersion) return true;
  const contextAt = context.generatedAt ? new Date(context.generatedAt) : null;
  if (contextAt && new Date(snapshot.generatedAt).getTime() < contextAt.getTime()) return true;
  if (new Date(decision.decidedAt).getTime() < new Date(snapshot.generatedAt).getTime()) return true;
  const selected = snapshot.scores.find((score) => score.action === decision.selectedAction);
  return !selected || selected.probability !== decision.selectedProbability || selected.expectedRecoveredMinor !== decision.expectedRecoveredMinor;
}
function executorFor(action: RecoveryActionType, notifications: RecoveryNotificationService): RecoveryActionExecutor {
  if (action === "WAIT_NATIVE_RETRY") return new WaitNativeRetryExecutor();
  if (action === "SEND_NUDGE") return new SendNudgeExecutor(notifications);
  if (action === "REQUEST_CARD_UPDATE") return new RequestCardUpdateExecutor();
  return new StopAndEscalateExecutor();
}
async function auditOnce(recoveryCase: InstanceType<typeof RecoveryCase>, actionId: string, eventType: "ACTION_EXECUTED" | "ACTION_EXECUTION_FAILED" | "WAITING_FOR_NATIVE_RETRY" | "NUDGE_PREPARED" | "NUDGE_SENT" | "CARD_UPDATE_REQUESTED" | "CASE_ESCALATED", title: string, metadata: Record<string, unknown>, occurredAt: Date): Promise<void> {
  await AuditEvent.findOneAndUpdate({ recoveryCaseId: recoveryCase._id, eventType, "metadata.actionId": actionId }, { $set: { razorpaySubscriptionId: recoveryCase.razorpaySubscriptionId, actor: "SYSTEM", title, metadata: { ...metadata, actionId }, occurredAt }, $setOnInsert: { recoveryCaseId: recoveryCase._id, eventType } }, { upsert: true });
}

export async function executeRecoveryDecision(caseId: string, now = new Date(), notifications: RecoveryNotificationService = new SimulationRecoveryNotificationService()): Promise<RecoveryExecutionResult> {
  if (!isValidObjectId(caseId)) throw new AppError(400, "Invalid recovery case ID.");
  let recoveryCase = await RecoveryCase.findById(caseId);
  if (!recoveryCase) throw new AppError(404, "Recovery case not found.");
  const decision = recoveryCase.latestDecision as unknown as RecoveryDecision | null;
  if (!decision) throw new AppError(409, "A current RecoveryDecision is required before execution.");
  const decisionId = decision.decisionId ?? recoveryDecisionId(recoveryCase.id, decision);
  const actionId = actionIdFor(decisionId);
  const existing = recoveryCase.actions.find((item) => item.decisionId === decisionId || item.actionId === actionId) as unknown as StoredAction | undefined;
  if (existing) return { caseId: recoveryCase.id, caseStatus: recoveryCase.status, action: safeAction(existing) };
  if (recoveryCase.status !== "DECIDED") throw new AppError(409, "Recovery case must be DECIDED before execution.");
  if (stale(recoveryCase, decision)) throw new AppError(409, "Recovery decision is stale. Diagnose, score, and decide again before execution.");
  const subscription = await Subscription.findById(recoveryCase.subscriptionId);
  if (!subscription) throw new AppError(404, "Recovery case subscription not found.");
  if (!subscription.customer || !subscription.plan) throw new AppError(409, "Recovery subscription details are incomplete.");
  const reservation = await RecoveryCase.updateOne({ _id: recoveryCase._id, status: "DECIDED", "actions.decisionId": { $ne: decisionId } }, { $set: { "latestDecision.decisionId": decisionId, status: "ACTION_PENDING" }, $push: { actions: { actionId, decisionId, type: decision.selectedAction, status: "PENDING", createdAt: now, executedAt: null, failedAt: null, failureReason: null, executionMode: decision.selectedAction === "REQUEST_CARD_UPDATE" ? "customer" : "internal", metadata: {} } } });
  recoveryCase = (await RecoveryCase.findById(recoveryCase._id))!;
  const reserved = recoveryCase.actions.find((item) => item.decisionId === decisionId) as unknown as StoredAction | undefined;
  if (!reserved) throw new AppError(409, "Recovery action could not be reserved.");
  if (reservation.modifiedCount === 0) return { caseId: recoveryCase.id, caseStatus: recoveryCase.status, action: safeAction(reserved) };
  if (reserved.status !== "PENDING" || reserved.metadata && Object.keys(reserved.metadata).length > 0) return { caseId: recoveryCase.id, caseStatus: recoveryCase.status, action: safeAction(reserved) };

  let result: ActionExecutionResult;
  try {
    result = await executorFor(decision.selectedAction, notifications).execute({ caseId: recoveryCase.id, actionId, decisionId, type: decision.selectedAction, razorpaySubscriptionId: recoveryCase.razorpaySubscriptionId, customer: { name: subscription.customer.name, email: subscription.customer.email }, plan: { name: subscription.plan.name, amountMinor: subscription.plan.amountMinor, currency: "INR" }, now });
  } catch (error) {
    const failureReason = error instanceof Error ? `Executor failed: ${error.message}`.slice(0, 300) : "Executor failed safely.";
    await RecoveryCase.updateOne({ _id: recoveryCase._id, "actions.actionId": actionId }, { $set: { "actions.$.status": "FAILED", "actions.$.failedAt": now, "actions.$.failureReason": failureReason, status: "ACTION_PENDING" } });
    await auditOnce(recoveryCase, actionId, "ACTION_EXECUTION_FAILED", "Recovery action execution failed", { selectedAction: decision.selectedAction, failureReason }, now);
    const failedCase = (await RecoveryCase.findById(recoveryCase._id))!; const failed = failedCase.actions.find((item) => item.actionId === actionId) as unknown as StoredAction;
    return { caseId: failedCase.id, caseStatus: failedCase.status, action: safeAction(failed) };
  }
  const caseStatus = decision.selectedAction === "STOP_AND_ESCALATE" ? "STOPPED" : result.status === "EXECUTED" ? "ACTION_EXECUTED" : "ACTION_PENDING";
  const caseSet: Record<string, unknown> = { "actions.$.status": result.status, "actions.$.executedAt": result.executedAt, "actions.$.failureReason": result.failureReason, "actions.$.executionMode": result.executionMode, "actions.$.metadata": result.metadata, status: caseStatus };
  if (caseStatus === "STOPPED") { caseSet.closedAt = now; caseSet["outcome.finalReason"] = "POLICY_STOPPED"; }
  await RecoveryCase.updateOne({ _id: recoveryCase._id, "actions.actionId": actionId }, { $set: caseSet });
  if (decision.selectedAction === "SEND_NUDGE" && result.metadata.customerContacted === true) await Subscription.updateOne({ _id: subscription._id }, { $inc: { "statistics.nudgesSent": 1 }, $set: { lastNudgeAt: now } });
  const event = decision.selectedAction === "WAIT_NATIVE_RETRY" ? ["WAITING_FOR_NATIVE_RETRY", "Waiting for Razorpay native retry"] as const : decision.selectedAction === "SEND_NUDGE" ? [result.metadata.customerContacted ? "NUDGE_SENT" : "NUDGE_PREPARED", result.metadata.customerContacted ? "Recovery nudge sent" : "Recovery nudge simulated"] as const : decision.selectedAction === "REQUEST_CARD_UPDATE" ? ["CARD_UPDATE_REQUESTED", "Card update recovery session requested"] as const : ["CASE_ESCALATED", "Case escalated for merchant review"] as const;
  await auditOnce(recoveryCase, actionId, event[0], event[1], { selectedAction: decision.selectedAction, status: result.status, executionMode: result.executionMode, customerContacted: result.metadata.customerContacted ?? false }, now);
  const storedCase = (await RecoveryCase.findById(recoveryCase._id))!; const storedAction = storedCase.actions.find((item) => item.actionId === actionId) as unknown as StoredAction;
  return { caseId: storedCase.id, caseStatus: storedCase.status, action: safeAction(storedAction), ...(result.recoveryUrl ? { recoveryUrl: result.recoveryUrl } : {}) };
}
