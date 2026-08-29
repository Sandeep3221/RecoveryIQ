import type { RequestHandler } from "express";
import { EvaluationRun } from "../models/EvaluationRun.js";

export const latestEvaluation: RequestHandler = async (_req, res) => {
  const evaluation = await EvaluationRun.findOne({ evaluationVersion: "policy-eval-v1" }).sort({ createdAt: -1 }).lean();
  res.json({ evaluation: evaluation ?? null });
};
