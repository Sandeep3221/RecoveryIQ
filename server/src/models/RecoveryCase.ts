import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { ACTION_STATUSES, POLICY_REASON_CODES, RECOVERY_ACTION_TYPES, RECOVERY_CASE_STATUSES } from "../domain/types.js";

const actionScoreSchema = new Schema({
  action: { type: String, enum: RECOVERY_ACTION_TYPES, required: true }, probability: { type: Number, required: true, min: 0, max: 1 },
  allowed: { type: Boolean, required: true }, expectedValueMinor: { type: Number, min: 0, validate: Number.isInteger }, blockedReason: String,
}, { _id: false });
const decisionSchema = new Schema({
  decisionId: { type: String, required: true }, evaluatedAt: { type: Date, required: true },
  selectedAction: { type: String, enum: RECOVERY_ACTION_TYPES, required: true }, reasonCode: { type: String, enum: POLICY_REASON_CODES, required: true },
  allowedActions: [{ type: String, enum: RECOVERY_ACTION_TYPES }], blockedActions: [{ type: String, enum: RECOVERY_ACTION_TYPES }],
  modelScores: { type: [actionScoreSchema], default: [] }, explanation: { type: String, required: true },
  policyVersion: { type: String, required: true }, modelVersion: { type: String, default: null },
}, { _id: false });
const actionSchema = new Schema({
  actionId: { type: String, required: true }, decisionId: { type: String, required: true },
  type: { type: String, enum: RECOVERY_ACTION_TYPES, required: true }, status: { type: String, enum: ACTION_STATUSES, required: true },
  createdAt: { type: Date, required: true }, executedAt: { type: Date, default: null }, failedAt: { type: Date, default: null },
  failureReason: { type: String, default: null }, executionMode: { type: String, enum: ["internal", "simulation", "live", "customer"], required: true },
  metadata: { type: Schema.Types.Mixed, default: {} }, errorMessage: { type: String, default: null },
}, { _id: false });
const recoveryScoreSchema = new Schema({
  action: { type: String, enum: RECOVERY_ACTION_TYPES, required: true },
  probability: { type: Number, required: true, min: 0, max: 1 },
  expectedRecoveredMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
  scorerVersion: { type: String, required: true },
  datasetVersion: { type: String, default: null },
  explanation: { type: String, required: true },
}, { _id: false });
const blockedRecoveryActionSchema = new Schema({
  action: { type: String, enum: RECOVERY_ACTION_TYPES, required: true },
  reasonCode: { type: String, enum: POLICY_REASON_CODES, required: true },
  explanation: { type: String, required: true },
}, { _id: false });
const latestDecisionSchema = new Schema({
  decisionId: { type: String, default: null },
  policyVersion: { type: String, required: true }, scorerVersion: { type: String, required: true },
  selectedAction: { type: String, enum: RECOVERY_ACTION_TYPES, required: true },
  selectedProbability: { type: Number, required: true, min: 0, max: 1 },
  expectedRecoveredMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
  reasonCode: { type: String, enum: POLICY_REASON_CODES, required: true }, explanation: { type: String, required: true },
  hardRuleApplied: { type: Boolean, required: true }, allowedActions: [{ type: String, enum: RECOVERY_ACTION_TYPES }],
  blockedActions: { type: [blockedRecoveryActionSchema], default: [] }, decidedAt: { type: Date, required: true },
}, { _id: false });
const recoveryCaseSchema = new Schema({
  subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription", required: true },
  razorpaySubscriptionId: { type: String, required: true }, status: { type: String, enum: RECOVERY_CASE_STATUSES, required: true },
  openedAt: { type: Date, required: true }, closedAt: { type: Date, default: null },
  revenueAtRiskMinor: { type: Number, required: true, min: 0, validate: Number.isInteger },
  recoveredAmountMinor: { type: Number, required: true, default: 0, min: 0, validate: Number.isInteger },
  failureEventIds: [{ type: Schema.Types.ObjectId, ref: "FailureEvent" }],
  latestContext: { type: Schema.Types.Mixed, default: null },
  latestScores: {
    type: new Schema({ scorerVersion: { type: String, required: true }, datasetVersion: { type: String, default: null }, generatedAt: { type: Date, required: true }, scores: { type: [recoveryScoreSchema], required: true } }, { _id: false }),
    default: null,
  },
  latestDecision: { type: latestDecisionSchema, default: null },
  decisions: { type: [decisionSchema], default: [] }, actions: { type: [actionSchema], default: [] },
  outcome: {
    outcomeId: { type: String, default: null }, status: { type: String, enum: ["RECOVERED", "UNRESOLVED"], default: "UNRESOLVED" }, observedAt: { type: Date, default: null },
    recoveredAmountMinor: { type: Number, default: 0, min: 0, validate: Number.isInteger }, remainingRiskMinor: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    razorpayPaymentId: { type: String, default: null }, razorpayInvoiceId: { type: String, default: null }, sourceEventId: { type: String, default: null },
    matchLevel: { type: String, enum: ["EXACT_INVOICE", "SUBSCRIPTION_ONLY", "NONE"], default: "NONE" }, caseMatchConfidence: { type: String, enum: ["HIGH", "MEDIUM", "LOW"], default: "LOW" },
    actionAtRecovery: { type: String, enum: RECOVERY_ACTION_TYPES, default: null }, actionAssociation: { type: String, enum: ["POST_ACTION_ASSOCIATION", "CARD_UPDATE_SEQUENCE", "NO_ACTION_ASSOCIATION", "UNATTRIBUTED"], default: "UNATTRIBUTED" },
    actionAssociationConfidence: { type: String, enum: ["HIGH", "MEDIUM", "LOW", "NONE"], default: "NONE" }, timeToRecoveryHours: { type: Number, default: null }, recoveredWithin7Days: { type: Boolean, default: null }, explanation: { type: String, default: null },
    payment: { paymentId: { type: String, default: null }, invoiceId: { type: String, default: null }, amountMinor: { type: Number, default: null }, currency: { type: String, enum: ["INR"], default: null }, status: { type: String, enum: ["captured"], default: null }, method: { type: String, default: null }, createdAt: { type: Date, default: null } },
    recovered: { type: Boolean, default: false }, recoveredAt: { type: Date, default: null }, recoveredPaymentId: { type: String, default: null },
    nativeRecovery: { type: Boolean, default: null }, finalReason: { type: String, enum: ["PAYMENT_RECOVERED", "SUBSCRIPTION_CANCELLED", "POLICY_STOPPED", "CASE_EXPIRED", "UNKNOWN"], default: "UNKNOWN" },
  },
}, { timestamps: true, collection: "recoveryCases" });
export type RecoveryCaseDocument = InferSchemaType<typeof recoveryCaseSchema>;
export const RecoveryCase: Model<RecoveryCaseDocument> =
  (models.RecoveryCase as Model<RecoveryCaseDocument> | undefined) ?? model<RecoveryCaseDocument>("RecoveryCase", recoveryCaseSchema);
