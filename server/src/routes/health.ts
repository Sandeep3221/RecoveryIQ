import { Router } from "express";
import mongoose from "mongoose";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../config/env.js";

export const healthRouter = Router();
healthRouter.get("/live", (_req, res) => res.json({ status: "ok" }));
healthRouter.get("/ready", (_req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  const scorerArtifactAvailable = existsSync(resolve(__dirname, "../services/scorer/models/logistic_recovery_v1.json"));
  const components = {
    database: databaseConnected ? "connected" : "disconnected",
    razorpayTestModeConfigured: env.RAZORPAY_KEY_ID.startsWith("rzp_test_") && Boolean(env.RAZORPAY_KEY_SECRET) && Boolean(env.RAZORPAY_WEBHOOK_SECRET),
    scorerMode: env.RECOVERY_SCORER,
    scorerArtifactAvailable,
    notificationMode: env.RECOVERY_NOTIFICATION_MODE,
  };
  if (databaseConnected && scorerArtifactAvailable) return res.json({ status: "ready", ...components });
  return res.status(503).json({ status: "not_ready", ...components });
});
