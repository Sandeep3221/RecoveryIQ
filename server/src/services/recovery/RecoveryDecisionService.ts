import { isValidObjectId } from "mongoose";
import { recoveryPolicy } from "../../config/recoveryPolicy.js";
import type { RecoveryDecision } from "../../domain/recovery/RecoveryDecision.js";
import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import { RECOVERY_ACTION_TYPES } from "../../domain/types.js";
import { AuditEvent } from "../../models/AuditEvent.js";
import { RecoveryCase } from "../../models/RecoveryCase.js";
import { AppError } from "../../utils/AppError.js";
import { evaluateRecoveryPolicy } from "../policy/RecoveryPolicyEngine.js";
import type { RecoveryScore } from "../scorer/RecoveryScorer.js";
import { recoveryDecisionId } from "./DecisionIdentity.js";

export interface RecoveryDecisionResult { caseId: string; status: "DECIDED"; decision: RecoveryDecision; }

function contextFrom(value: unknown): RecoveryContext {
  if (!value || typeof value !== "object") throw new AppError(409, "Recovery scoring required before policy evaluation.");
  const context = value as RecoveryContext;
  if (!context.subscription || !context.failure || !context.customerHistory || !context.downtime || !context.caseState) throw new AppError(409, "Recovery scoring required before policy evaluation.");
  return context;
}

function scoresFrom(value: unknown): { scorerVersion: string; generatedAt: Date; scores: RecoveryScore[] } {
  if (!value || typeof value !== "object") throw new AppError(409, "Recovery scoring required before policy evaluation.");
  const snapshot = value as { scorerVersion?: unknown; generatedAt?: unknown; scores?: unknown };
  if (typeof snapshot.scorerVersion !== "string" || !snapshot.generatedAt || !Array.isArray(snapshot.scores) || snapshot.scores.length !== RECOVERY_ACTION_TYPES.length) throw new AppError(409, "Recovery scoring required before policy evaluation.");
  const scores = snapshot.scores as RecoveryScore[];
  const actions = new Set(scores.map((score) => score.action));
  if (actions.size !== RECOVERY_ACTION_TYPES.length || RECOVERY_ACTION_TYPES.some((action) => !actions.has(action)) || scores.some((score) => score.scorerVersion !== snapshot.scorerVersion || !Number.isFinite(score.probability) || score.probability < 0 || score.probability > 1 || !Number.isInteger(score.expectedRecoveredMinor))) throw new AppError(409, "Recovery scoring required before policy evaluation.");
  return { scorerVersion: snapshot.scorerVersion, generatedAt: new Date(snapshot.generatedAt as Date), scores };
}

export async function decideRecoveryCase(caseId: string, now = new Date()): Promise<RecoveryDecisionResult> {
  if (!isValidObjectId(caseId)) throw new AppError(400, "Invalid recovery case ID.");
  const recoveryCase = await RecoveryCase.findById(caseId);
  if (!recoveryCase) throw new AppError(404, "Recovery case not found.");
  if (recoveryCase.status !== "DIAGNOSED" && recoveryCase.status !== "DECIDED") throw new AppError(409, "Recovery case must be DIAGNOSED before policy evaluation.");
  if (recoveryCase.closedAt) throw new AppError(409, "Closed recovery cases cannot be evaluated.");
  const context = contextFrom(recoveryCase.latestContext);
  const scoreSnapshot = scoresFrom(recoveryCase.latestScores);
  const contextGeneratedAt = context.generatedAt
    ? new Date(context.generatedAt)
    : (await AuditEvent.findOne({ recoveryCaseId: recoveryCase._id, eventType: "CONTEXT_BUILT" }).sort({ occurredAt: -1 }).select("occurredAt"))?.occurredAt;
  if (!contextGeneratedAt) throw new AppError(409, "Recovery scores are stale. Rescore before policy evaluation.");
  if (scoreSnapshot.generatedAt.getTime() < contextGeneratedAt.getTime()) throw new AppError(409, "Recovery scores are stale. Rescore before policy evaluation.");

  if (recoveryCase.status === "DECIDED" && recoveryCase.latestDecision) {
    return { caseId: recoveryCase.id, status: "DECIDED", decision: recoveryCase.latestDecision as unknown as RecoveryDecision };
  }
  const decision = evaluateRecoveryPolicy({ context, scores: scoreSnapshot.scores, policyConfig: recoveryPolicy, decidedAt: now });
  decision.decisionId = recoveryDecisionId(recoveryCase.id, decision);
  recoveryCase.set("latestDecision", decision);
  recoveryCase.status = "DECIDED";
  await recoveryCase.save();
  await AuditEvent.findOneAndUpdate(
    { recoveryCaseId: recoveryCase._id, eventType: "POLICY_EVALUATED" },
    { $set: { razorpaySubscriptionId: recoveryCase.razorpaySubscriptionId, actor: "POLICY_ENGINE", title: "Recovery policy evaluated", metadata: { policyVersion: decision.policyVersion, scorerVersion: decision.scorerVersion, selectedAction: decision.selectedAction, reasonCode: decision.reasonCode, hardRuleApplied: decision.hardRuleApplied, decidedAt: decision.decidedAt }, occurredAt: decision.decidedAt }, $setOnInsert: { recoveryCaseId: recoveryCase._id, eventType: "POLICY_EVALUATED" } },
    { upsert: true },
  );
  return { caseId: recoveryCase.id, status: "DECIDED", decision };
}
