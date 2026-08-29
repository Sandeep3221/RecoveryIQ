import { AUTHENTICATION_REASONS, BANK_OR_NETWORK_SOURCES, EXACT_FAILURE_REASON_RULES, FAILURE_CLASSIFICATION_VERSION } from "../../config/failureClassification.js";
import type { FailureCategory } from "../../domain/types.js";

export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ClassificationMatch = "EXACT_REASON" | "SOURCE_FALLBACK" | "PATTERN_FALLBACK" | "UNKNOWN";

export interface FailureClassification {
  category: FailureCategory;
  confidence: ClassificationConfidence;
  matchedBy: ClassificationMatch;
  matchedRule: string | null;
  explanation: string;
}

export interface FailureClassifierInput {
  reason: string | null;
  source: string | null;
  step: string | null;
  code: string | null;
  paymentMethod: string;
}

export interface FailureClassifierService { classify(input: FailureClassifierInput): FailureClassification }

function normalize(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized || null;
}

export class DeterministicFailureClassifier implements FailureClassifierService {
  classify(input: FailureClassifierInput): FailureClassification {
    const reason = normalize(input.reason);
    const source = normalize(input.source);
    const step = normalize(input.step);
    if (reason) {
      const exact = EXACT_FAILURE_REASON_RULES[reason];
      if (exact) return {
        ...exact, matchedBy: "EXACT_REASON", matchedRule: `error_reason=${reason}`,
        explanation: `Razorpay reported error_reason=${reason}, which is mapped by ${FAILURE_CLASSIFICATION_VERSION} to ${exact.category}.`,
      };
      const hasMandate = reason.includes("mandate");
      const hasInvalidatingTerm = ["revoked", "cancelled", "canceled", "invalid", "expired"].some((term) => reason.includes(term));
      if (hasMandate && hasInvalidatingTerm) return {
        category: "MANDATE_OR_AUTH_INVALID", confidence: "MEDIUM", matchedBy: "PATTERN_FALLBACK", matchedRule: "mandate+invalidating_term",
        explanation: `Razorpay reported error_reason=${reason}; ${FAILURE_CLASSIFICATION_VERSION} matched a mandate invalidation pattern.`,
      };
    }
    if (source && BANK_OR_NETWORK_SOURCES.has(source)) return {
      category: "BANK_OR_NETWORK", confidence: "MEDIUM", matchedBy: "SOURCE_FALLBACK", matchedRule: `error_source=${source}`,
      explanation: `Razorpay reported error_source=${source} and no more-specific reason rule matched, so ${FAILURE_CLASSIFICATION_VERSION} categorized the failure as BANK_OR_NETWORK.`,
    };
    if (step === "payment_authentication" && reason && AUTHENTICATION_REASONS.has(reason)) return {
      category: "CUSTOMER_AUTH_FAILURE", confidence: "MEDIUM", matchedBy: "PATTERN_FALLBACK", matchedRule: "payment_authentication+credential_reason",
      explanation: `Razorpay reported error_step=payment_authentication with error_reason=${reason}, which ${FAILURE_CLASSIFICATION_VERSION} treats as customer authentication evidence.`,
    };
    const evidence = reason ? `error_reason=${reason}` : "no error reason";
    return {
      category: "UNKNOWN", confidence: "LOW", matchedBy: "UNKNOWN", matchedRule: null,
      explanation: reason
        ? `No known deterministic rule matched Razorpay ${evidence}. The failure remains UNKNOWN.`
        : "Razorpay did not provide sufficient failure evidence for a deterministic classification. The failure remains UNKNOWN.",
    };
  }
}

export const failureClassifier = new DeterministicFailureClassifier();
