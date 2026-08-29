import type { RecoveryActionType } from "../types.js";

export type RecoveryMatchLevel = "EXACT_INVOICE" | "SUBSCRIPTION_ONLY" | "NONE";
export type ActionAssociation = "POST_ACTION_ASSOCIATION" | "CARD_UPDATE_SEQUENCE" | "NO_ACTION_ASSOCIATION" | "UNATTRIBUTED";
export interface RecoveryOutcome {
  outcomeId: string; status: "RECOVERED" | "UNRESOLVED"; observedAt: Date; recoveredAt: Date | null;
  recoveredAmountMinor: number; remainingRiskMinor: number; razorpayPaymentId: string | null; razorpayInvoiceId: string | null;
  sourceEventId: string | null; matchLevel: RecoveryMatchLevel; caseMatchConfidence: "HIGH" | "MEDIUM" | "LOW";
  actionAtRecovery: RecoveryActionType | null; actionAssociation: ActionAssociation;
  actionAssociationConfidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  timeToRecoveryHours: number | null; recoveredWithin7Days: boolean | null; explanation: string;
  payment: { paymentId: string; invoiceId: string | null; amountMinor: number; currency: "INR"; status: "captured"; method: string; createdAt: Date | null };
}
