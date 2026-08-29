import type { RequestHandler } from "express";
import { mongo } from "mongoose";
import { env } from "../config/env.js";
import { AuditEvent } from "../models/AuditEvent.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { normalizeRazorpayWebhook } from "../services/razorpay/RazorpayEventNormalizer.js";
import { processRazorpayWebhook } from "../services/razorpay/RazorpayWebhookProcessor.js";
import { verifyRazorpayWebhookSignature } from "../services/razorpay/RazorpayWebhookVerifier.js";
import { AppError } from "../utils/AppError.js";

function headerValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const receiveRazorpayWebhook: RequestHandler = async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new AppError(400, "Webhook request must contain a raw JSON body.");
  const signature = headerValue(req.headers["x-razorpay-signature"]);
  const eventId = headerValue(req.headers["x-razorpay-event-id"]);
  if (!signature) throw new AppError(400, "Missing X-Razorpay-Signature header.");
  if (!eventId) throw new AppError(400, "Missing x-razorpay-event-id header.");
  if (!verifyRazorpayWebhookSignature(req.body, signature, env.RAZORPAY_WEBHOOK_SECRET)) throw new AppError(401, "Invalid Razorpay webhook signature.");

  const receivedAt = new Date();
  const event = normalizeRazorpayWebhook(req.body, receivedAt);
  let record;
  try {
    record = await WebhookEvent.create({
      razorpayEventId: eventId,
      eventType: event.eventType,
      accountId: event.accountId,
      processingStatus: "RECEIVED",
      subscriptionId: event.subscription?.id ?? null,
      paymentId: event.payment?.id ?? null,
      receivedAt,
    });
  } catch (error) {
    if (!(error instanceof mongo.MongoServerError) || error.code !== 11000) throw error;
    const existing = await WebhookEvent.findOne({ razorpayEventId: eventId });
    await AuditEvent.create({
      recoveryCaseId: null,
      razorpaySubscriptionId: existing?.subscriptionId ?? event.subscription?.id ?? null,
      eventType: "WEBHOOK_DUPLICATE",
      actor: "RAZORPAY",
      title: "Duplicate Razorpay webhook ignored",
      metadata: { razorpayEventId: eventId, eventType: existing?.eventType ?? event.eventType },
      occurredAt: receivedAt,
    });
    res.json({ received: true, duplicate: true });
    return;
  }

  record.processingStatus = "PROCESSING";
  await record.save();
  try {
    const result = await processRazorpayWebhook(record._id, event);
    record.processingStatus = result;
    record.processedAt = new Date();
    await record.save();
    res.json({ received: true });
  } catch (error) {
    const safeMessage = error instanceof AppError ? error.message : "Webhook processing failed.";
    record.processingStatus = "FAILED";
    record.processedAt = new Date();
    record.error = { message: safeMessage };
    await record.save();
    throw new AppError(500, "Webhook processing failed.");
  }
};
