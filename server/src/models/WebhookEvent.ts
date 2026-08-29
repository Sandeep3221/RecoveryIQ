import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const WEBHOOK_PROCESSING_STATUSES = ["RECEIVED", "PROCESSING", "PROCESSED", "IGNORED", "FAILED"] as const;
const webhookEventSchema = new Schema({
  razorpayEventId: { type: String, required: true, unique: true },
  eventType: { type: String, required: true },
  accountId: { type: String, default: null },
  processingStatus: { type: String, enum: WEBHOOK_PROCESSING_STATUSES, default: "RECEIVED", required: true },
  subscriptionId: { type: String, default: null },
  paymentId: { type: String, default: null },
  receivedAt: { type: Date, required: true, default: Date.now },
  processedAt: { type: Date, default: null },
  error: { message: { type: String } },
}, { timestamps: true, collection: "webhookEvents" });
export type WebhookEventDocument = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEvent: Model<WebhookEventDocument> =
  (models.WebhookEvent as Model<WebhookEventDocument> | undefined) ?? model<WebhookEventDocument>("WebhookEvent", webhookEventSchema);
