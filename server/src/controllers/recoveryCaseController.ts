import type { RequestHandler } from "express";
import { z } from "zod";
import { RecoveryCase } from "../models/RecoveryCase.js";
import { AppError } from "../utils/AppError.js";
import { isValidObjectId } from "mongoose";
import { AuditEvent } from "../models/AuditEvent.js";
import { FailureEvent } from "../models/FailureEvent.js";
import { diagnoseRecoveryCase } from "../services/recovery/RecoveryDiagnosisService.js";
import { scoreRecoveryCase } from "../services/recovery/RecoveryScoringService.js";
import { decideRecoveryCase } from "../services/recovery/RecoveryDecisionService.js";
import { executeRecoveryDecision } from "../services/recovery/RecoveryExecutionService.js";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
function safeRecoveryCase<T extends { actions?: Array<{ metadata?: Record<string, unknown> }> }>(value: T): T {
  if (!value.actions) return value;
  return { ...value, actions: value.actions.map((action) => { const metadata = { ...(action.metadata ?? {}) }; delete metadata.tokenHash; return { ...action, metadata }; }) };
}

export const listRecoveryCases: RequestHandler = async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, "Invalid recovery case pagination.");
  const { page, limit } = parsed.data;
  const [items, total] = await Promise.all([
    RecoveryCase.find().populate({ path: "subscriptionId", select: "customer plan" }).sort({ openedAt: -1 }).skip((page - 1) * limit).limit(limit),
    RecoveryCase.countDocuments(),
  ]);
  res.json({ items: items.map((item) => safeRecoveryCase(item.toObject())), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
};

export const getRecoveryCase: RequestHandler = async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string" || !isValidObjectId(id)) throw new AppError(400, "Invalid recovery case ID.");
  const recoveryCase = await RecoveryCase.findById(id).populate({ path: "subscriptionId", select: "customer plan status razorpaySubscriptionId statistics razorpayCreatedAt lastNudgeAt" });
  if (!recoveryCase) throw new AppError(404, "Recovery case not found.");
  const [failures, auditEvents] = await Promise.all([
    FailureEvent.find({ _id: { $in: recoveryCase.failureEventIds } }).sort({ occurredAt: -1 }),
    AuditEvent.find({ recoveryCaseId: recoveryCase._id }).sort({ occurredAt: 1 }).select("eventType actor title metadata occurredAt"),
  ]);
  res.json({ case: safeRecoveryCase(recoveryCase.toObject()), latestFailure: failures[0] ?? null, failures, actionCount: recoveryCase.actions.length, auditEvents });
};

export const diagnoseCase: RequestHandler = async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string") throw new AppError(400, "Invalid recovery case ID.");
  const result = await diagnoseRecoveryCase(id);
  res.json(result);
};

export const scoreCase: RequestHandler = async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string") throw new AppError(400, "Invalid recovery case ID.");
  res.json(await scoreRecoveryCase(id));
};

export const decideCase: RequestHandler = async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string") throw new AppError(400, "Invalid recovery case ID.");
  res.json(await decideRecoveryCase(id));
};

export const executeCase: RequestHandler = async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string") throw new AppError(400, "Invalid recovery case ID.");
  res.json(await executeRecoveryDecision(id));
};
