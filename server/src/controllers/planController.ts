import type { RequestHandler } from "express";
import { resolveCloudDeskPlans } from "../services/razorpay/RazorpayPlanService.js";

export const listPlans: RequestHandler = async (_req, res) => {
  const plans = await resolveCloudDeskPlans(true);
  res.json({ items: plans.map(({ key, razorpayPlanId, name, amountMinor, currency, period, interval }) => ({ key, razorpayPlanId, name, amountMinor, currency, period, interval })) });
};
