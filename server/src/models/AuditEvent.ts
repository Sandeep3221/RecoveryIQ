import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const AUDIT_EVENT_TYPES = ["WEBHOOK_RECEIVED", "WEBHOOK_DUPLICATE", "FAILURE_DETECTED", "FAILURE_CLASSIFIED", "DOWNTIME_CHECKED", "CONTEXT_BUILT", "RECOVERY_SCORED", "POLICY_EVALUATED", "ACTION_SELECTED", "ACTION_CREATED", "ACTION_EXECUTED", "ACTION_EXECUTION_FAILED", "WAIT_STARTED", "WAITING_FOR_NATIVE_RETRY", "NUDGE_PREPARED", "NUDGE_SENT", "CARD_UPDATE_REQUESTED", "CARD_UPDATE_COMPLETED", "CASE_ESCALATED", "RECOVERY_STOPPED", "PAYMENT_RECOVERED", "RECOVERY_OBSERVED", "REVENUE_RECOVERED", "RECOVERY_SUCCESS_UNMATCHED", "SUBSCRIPTION_ACTIVATED", "SUBSCRIPTION_HALTED", "SUBSCRIPTION_CANCELLED"] as const;
export const AUDIT_ACTORS = ["RAZORPAY", "SYSTEM", "POLICY_ENGINE", "ML_MODEL", "LLM", "MERCHANT", "CUSTOMER"] as const;
const auditEventSchema = new Schema({
  recoveryCaseId: { type: Schema.Types.ObjectId, ref: "RecoveryCase", default: null },
  razorpaySubscriptionId: { type: String, default: null }, eventType: { type: String, enum: AUDIT_EVENT_TYPES, required: true },
  actor: { type: String, enum: AUDIT_ACTORS, required: true }, title: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} }, occurredAt: { type: Date, required: true },
}, { timestamps: true, collection: "auditEvents" });
export type AuditEventDocument = InferSchemaType<typeof auditEventSchema>;
export const AuditEvent: Model<AuditEventDocument> =
  (models.AuditEvent as Model<AuditEventDocument> | undefined) ?? model<AuditEventDocument>("AuditEvent", auditEventSchema);
