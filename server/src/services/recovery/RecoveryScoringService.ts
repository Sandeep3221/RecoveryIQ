import { isValidObjectId } from "mongoose";
import { RECOVERY_ACTION_TYPES } from "../../domain/types.js";
import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import { AuditEvent } from "../../models/AuditEvent.js";
import { RecoveryCase } from "../../models/RecoveryCase.js";
import { AppError } from "../../utils/AppError.js";
import type { RecoveryScore, RecoveryScorer } from "../scorer/RecoveryScorer.js";
import { getConfiguredRecoveryScorer } from "../scorer/RecoveryScorerFactory.js";

export interface RecoveryScoringResult {
  caseId: string;
  scorerVersion: string;
  datasetVersion: string | null;
  scores: RecoveryScore[];
}

function contextFrom(value: unknown, revenueAtRiskMinor: number): RecoveryContext {
  if (!value || typeof value !== "object") throw new AppError(409, "Diagnosis required before scoring.");
  const context = value as RecoveryContext;
  if (!context.subscription || !context.failure || !context.customerHistory || !context.diagnosis || !context.downtime || !context.caseState) {
    throw new AppError(409, "Diagnosis required before scoring.");
  }
  return { ...context, caseState: { ...context.caseState, revenueAtRiskMinor } };
}

function validateScores(scores: RecoveryScore[]): string {
  if (scores.length !== RECOVERY_ACTION_TYPES.length) throw new AppError(500, "Recovery scorer returned an invalid score set.");
  const actions = new Set(scores.map((score) => score.action));
  for (const action of RECOVERY_ACTION_TYPES) if (!actions.has(action)) throw new AppError(500, "Recovery scorer omitted a candidate action.");
  for (const score of scores) {
    if (!Number.isFinite(score.probability) || score.probability < 0 || score.probability > 1 || !Number.isInteger(score.expectedRecoveredMinor) || score.expectedRecoveredMinor < 0 || !score.explanation || !score.scorerVersion) {
      throw new AppError(500, "Recovery scorer returned an invalid score.");
    }
  }
  const versions = new Set(scores.map((score) => score.scorerVersion));
  if (versions.size !== 1) throw new AppError(500, "Recovery scorer returned inconsistent versions.");
  return scores[0]!.scorerVersion;
}

export async function scoreRecoveryCase(caseId: string, now = new Date(), scorer: RecoveryScorer = getConfiguredRecoveryScorer()): Promise<RecoveryScoringResult> {
  if (!isValidObjectId(caseId)) throw new AppError(400, "Invalid recovery case ID.");
  const recoveryCase = await RecoveryCase.findById(caseId);
  if (!recoveryCase) throw new AppError(404, "Recovery case not found.");
  if (recoveryCase.status === "DETECTED") throw new AppError(409, "Diagnosis required before scoring.");
  if (recoveryCase.status !== "DIAGNOSED" || recoveryCase.closedAt) throw new AppError(409, "This recovery case cannot be scored.");
  const context = contextFrom(recoveryCase.latestContext, recoveryCase.revenueAtRiskMinor);
  const scores = scorer.score(context);
  const scorerVersion = validateScores(scores);
  const datasetVersions = new Set(scores.map((score) => score.datasetVersion).filter((value): value is string => Boolean(value)));
  if (datasetVersions.size > 1) throw new AppError(500, "Recovery scorer returned inconsistent dataset versions.");
  const datasetVersion = datasetVersions.values().next().value ?? null;
  recoveryCase.set("latestScores", { scorerVersion, datasetVersion, generatedAt: now, scores });
  await recoveryCase.save();
  await AuditEvent.findOneAndUpdate(
    { recoveryCaseId: recoveryCase._id, eventType: "RECOVERY_SCORED" },
    { $set: { razorpaySubscriptionId: recoveryCase.razorpaySubscriptionId, actor: "SYSTEM", title: "Recovery possibilities scored", metadata: { scorerVersion, datasetVersion, scoreCount: scores.length, generatedAt: now }, occurredAt: now }, $setOnInsert: { recoveryCaseId: recoveryCase._id, eventType: "RECOVERY_SCORED" } },
    { upsert: true },
  );
  return { caseId: recoveryCase.id, scorerVersion, datasetVersion, scores };
}
