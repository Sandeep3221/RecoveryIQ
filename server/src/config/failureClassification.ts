import type { FailureCategory } from "../domain/types.js";

export const FAILURE_CLASSIFICATION_VERSION = "classifier-v1";

export interface ExactFailureRule {
  category: FailureCategory;
  confidence: "HIGH" | "MEDIUM";
}

export const EXACT_FAILURE_REASON_RULES: Readonly<Record<string, ExactFailureRule>> = Object.freeze({
  insufficient_funds: { category: "TEMPORARY_FUNDS", confidence: "HIGH" },
  card_expired: { category: "PAYMENT_METHOD_INVALID", confidence: "HIGH" },
  debit_instrument_inactive: { category: "PAYMENT_METHOD_INVALID", confidence: "HIGH" },
  debit_instrument_blocked: { category: "PAYMENT_METHOD_INVALID", confidence: "HIGH" },
  card_not_enrolled: { category: "PAYMENT_METHOD_INVALID", confidence: "HIGH" },
  incorrect_otp: { category: "CUSTOMER_AUTH_FAILURE", confidence: "HIGH" },
  incorrect_cvv: { category: "CUSTOMER_AUTH_FAILURE", confidence: "HIGH" },
  otp_attempts_exceeded: { category: "CUSTOMER_AUTH_FAILURE", confidence: "HIGH" },
  payment_cancelled: { category: "CUSTOMER_AUTH_FAILURE", confidence: "MEDIUM" },
});

export const BANK_OR_NETWORK_SOURCES = new Set(["bank", "gateway", "network"]);
export const AUTHENTICATION_REASONS = new Set(["incorrect_otp", "incorrect_cvv", "otp_attempts_exceeded"]);
