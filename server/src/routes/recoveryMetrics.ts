import { Router } from "express";
import { recoveryMetrics } from "../controllers/recoveryMetricsController.js";
export const recoveryMetricsRouter = Router();
recoveryMetricsRouter.get("/", recoveryMetrics);
