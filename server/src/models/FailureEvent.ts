import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { FAILURE_CATEGORIES } from "../domain/types.js";

export const PAYMENT_METHODS = ["card", "upi", "emandate", "netbanking", "unknown"] as const;
const failureEventSchema = new Schema({
  webhookEventId: { type: Schema.Types.ObjectId, ref: "WebhookEvent", required: true },
  razorpaySubscriptionId: { type: String, required: true },
  razorpayPaymentId: { type: String, required: true },
  razorpayInvoiceId: { type: String, default: null },
  amountMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
  currency: { type: String, enum: ["INR"], default: "INR" },
  paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "unknown" },
  razorpayError: {
    code: { type: String, default: null }, description: { type: String, default: null },
    source: { type: String, default: null }, step: { type: String, default: null }, reason: { type: String, default: null },
  },
  normalizedCategory: { type: String, enum: FAILURE_CATEGORIES, required: true },
  classification: {
    version: { type: String, default: null },
    confidence: { type: String, enum: ["HIGH", "MEDIUM", "LOW"], default: null },
    matchedBy: { type: String, enum: ["EXACT_REASON", "SOURCE_FALLBACK", "PATTERN_FALLBACK", "UNKNOWN"], default: null },
    matchedRule: { type: String, default: null },
    explanation: { type: String, default: null },
    classifiedAt: { type: Date, default: null },
  },
  downtimeSnapshot: {
    checked: { type: Boolean, default: false }, active: { type: Boolean, default: false },
    matched: { type: Boolean, default: false }, matchLevel: { type: String, enum: ["EXACT", "METHOD_ONLY", "NONE", "UNKNOWN"], default: "UNKNOWN" },
    method: { type: String, default: null }, severity: { type: String, default: null },
    downtimeId: { type: String, default: null }, checkedAt: { type: Date, default: null }, explanation: { type: String, default: null },
  },
  occurredAt: { type: Date, required: true },
}, { timestamps: true, collection: "failureEvents" });
failureEventSchema.index({ razorpaySubscriptionId: 1 });
failureEventSchema.index(
  { razorpayPaymentId: 1 },
  { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: "string" } } },
);
failureEventSchema.index({ normalizedCategory: 1 });
failureEventSchema.index({ occurredAt: 1 });
export type FailureEventDocument = InferSchemaType<typeof failureEventSchema>;
export const FailureEvent: Model<FailureEventDocument> =
  (models.FailureEvent as Model<FailureEventDocument> | undefined) ?? model<FailureEventDocument>("FailureEvent", failureEventSchema);
