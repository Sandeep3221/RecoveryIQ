import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { SUBSCRIPTION_STATUSES } from "../domain/types.js";

const subscriptionSchema = new Schema({
  razorpaySubscriptionId: { type: String, required: true, unique: true, index: true, trim: true },
  razorpayPlanId: { type: String, default: null },
  razorpayCustomerId: { type: String, default: null },
  customer: {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    contact: { type: String },
  },
  plan: {
    name: { type: String, required: true },
    amountMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
    currency: { type: String, enum: ["INR"], default: "INR" },
  },
  status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true, index: true },
  authentication: {
    paymentId: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
  },
  statistics: {
    successfulPayments: { type: Number, default: 0, min: 0 },
    failedPayments: { type: Number, default: 0, min: 0 },
    recoveredPayments: { type: Number, default: 0, min: 0 },
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    nudgesSent: { type: Number, default: 0, min: 0 },
  },
  lastFailureAt: { type: Date, default: null },
  lastSuccessfulPaymentAt: { type: Date, default: null },
  lastNudgeAt: { type: Date, default: null },
  razorpayCreatedAt: { type: Date, required: true },
  razorpayCurrentStartAt: { type: Date, default: null },
  razorpayCurrentEndAt: { type: Date, default: null },
  razorpayChargeAt: { type: Date, default: null },
  lastWebhookOccurredAt: { type: Date, default: null },
}, { timestamps: true, collection: "subscriptions" });

subscriptionSchema.index({ "customer.email": 1 });
export type SubscriptionDocument = InferSchemaType<typeof subscriptionSchema>;
export const Subscription: Model<SubscriptionDocument> =
  (models.Subscription as Model<SubscriptionDocument> | undefined) ??
  model<SubscriptionDocument>("Subscription", subscriptionSchema);
