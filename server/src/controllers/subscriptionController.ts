import type { RequestHandler } from "express";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { CLOUDDESK_PLAN_KEYS } from "../config/cloudDeskPlans.js";
import { env } from "../config/env.js";
import { SUBSCRIPTION_STATUSES } from "../domain/types.js";
import { Subscription } from "../models/Subscription.js";
import { RecoveryCase } from "../models/RecoveryCase.js";
import { fetchRazorpaySubscription, createRazorpaySubscription, synchronizeLocalSubscription, synchronizeLocalSubscriptionFromRemote } from "../services/razorpay/RazorpaySubscriptionService.js";
import { verifySubscriptionAuthorizationSignature } from "../services/razorpay/RazorpaySignatureService.js";
import { AppError } from "../utils/AppError.js";

const createSchema = z.object({
  planKey: z.enum(CLOUDDESK_PLAN_KEYS),
  customer: z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(254), contact: z.string().trim().min(7).max(20).optional() }),
}).strict();
const verifySchema = z.object({
  razorpay_payment_id: z.string().trim().min(1).max(100),
  razorpay_subscription_id: z.string().trim().min(1).max(100),
  razorpay_signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
}).strict();
const listSchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError(400, parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return parsed.data;
}

export const createSubscription: RequestHandler = async (req, res) => {
  const input = parseOrThrow(createSchema, req.body);
  const customer = input.customer.contact
    ? { name: input.customer.name, email: input.customer.email, contact: input.customer.contact }
    : { name: input.customer.name, email: input.customer.email };
  const subscription = await createRazorpaySubscription(input.planKey, customer);
  res.status(201).json({
    subscription,
    checkout: { keyId: env.RAZORPAY_KEY_ID, subscriptionId: subscription.razorpaySubscriptionId, name: "CloudDesk", description: `${subscription.plan?.name ?? "CloudDesk"} subscription` },
  });
};

export const listSubscriptions: RequestHandler = async (req, res) => {
  const query = parseOrThrow(listSchema, req.query);
  const filter = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    Subscription.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit),
    Subscription.countDocuments(filter),
  ]);
  const openCases = await RecoveryCase.find({ subscriptionId: { $in: items.map((item) => item._id) }, status: { $in: ["DETECTED", "DIAGNOSED", "DECIDED", "ACTION_PENDING", "ACTION_EXECUTED"] } }).select("subscriptionId");
  const openSubscriptionIds = new Set(openCases.map((item) => String(item.subscriptionId)));
  res.json({
    items: items.map((item) => ({ ...item.toObject(), openRecoveryCase: openSubscriptionIds.has(String(item._id)) })),
    pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
  });
};

export const getSubscription: RequestHandler = async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string" || !isValidObjectId(id)) throw new AppError(400, "Invalid local subscription ID.");
  const subscription = await Subscription.findById(id);
  if (!subscription) throw new AppError(404, "Subscription not found.");
  res.json({ subscription });
};

export const syncSubscription: RequestHandler = async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string" || !isValidObjectId(id)) throw new AppError(400, "Invalid local subscription ID.");
  const subscription = await synchronizeLocalSubscription(id);
  res.json({ subscription });
};

export const verifyAuthorization: RequestHandler = async (req, res) => {
  const input = parseOrThrow(verifySchema, req.body);
  const local = await Subscription.findOne({ razorpaySubscriptionId: input.razorpay_subscription_id });
  if (!local) throw new AppError(400, "No local subscription matches this authorization.");
  const authoritativeId = local.razorpaySubscriptionId;
  if (!verifySubscriptionAuthorizationSignature(input.razorpay_payment_id, authoritativeId, input.razorpay_signature)) {
    throw new AppError(400, "Subscription authorization signature is invalid.");
  }
  const remote = await fetchRazorpaySubscription(authoritativeId);
  const subscription = await synchronizeLocalSubscriptionFromRemote(local.id, remote);
  subscription.authentication = { paymentId: input.razorpay_payment_id, verifiedAt: new Date() };
  await subscription.save();
  res.json({ message: "Subscription authorization verified.", subscription });
};
