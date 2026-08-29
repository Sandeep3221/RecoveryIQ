import type { RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../utils/AppError.js";
import { getCardUpdateRecoverySession, verifyCardUpdateRecovery } from "../services/recovery/CardUpdateRecoveryService.js";

const verifySchema = z.object({ token: z.string().min(20).max(200), razorpay_payment_id: z.string().min(1), razorpay_subscription_id: z.string().min(1), razorpay_signature: z.string().min(1) }).strict();
export const getCardUpdateSession: RequestHandler = async (req, res) => { const token = req.params.token; if (typeof token !== "string") throw new AppError(400, "Invalid recovery token."); res.json(await getCardUpdateRecoverySession(token)); };
export const verifyCardUpdate: RequestHandler = async (req, res) => { const parsed = verifySchema.safeParse(req.body); if (!parsed.success) throw new AppError(400, "Invalid card update verification payload."); res.json(await verifyCardUpdateRecovery(parsed.data)); };
