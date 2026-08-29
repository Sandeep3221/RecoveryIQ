import type { RequestHandler } from "express";
import { getRecoveryMetrics } from "../services/metrics/RecoveryMetricsService.js";
export const recoveryMetrics: RequestHandler = async (_req, res) => { res.json(await getRecoveryMetrics()); };
