import { z } from "zod";
import { PAYMENT_METHODS } from "../../models/FailureEvent.js";
import { AppError } from "../../utils/AppError.js";

const subscriptionEntitySchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  plan_id: z.string().nullish(),
  customer_id: z.string().nullish(),
  current_start: z.number().nullish(),
  current_end: z.number().nullish(),
  charge_at: z.number().nullish(),
}).passthrough();

const paymentEntitySchema = z.object({
  id: z.string().nullish(),
  amount: z.number().int().nonnegative().nullish(),
  currency: z.string().nullish(),
  status: z.string().nullish(),
  method: z.string().nullish(),
  invoice_id: z.string().nullish(),
  order_id: z.string().nullish(),
  error_code: z.string().nullish(),
  error_description: z.string().nullish(),
  error_source: z.string().nullish(),
  error_step: z.string().nullish(),
  error_reason: z.string().nullish(),
  created_at: z.number().int().positive().nullish(),
}).passthrough();

const envelopeSchema = z.object({
  event: z.string().min(1),
  account_id: z.string().nullish(),
  created_at: z.number().int().positive().optional(),
  payload: z.object({
    subscription: z.object({ entity: subscriptionEntitySchema }).optional(),
    payment: z.object({ entity: paymentEntitySchema }).optional(),
  }).passthrough().default({}),
}).passthrough();

export type NormalizedPaymentMethod = (typeof PAYMENT_METHODS)[number];
export interface NormalizedRazorpayPayment {
  id: string | null;
  amountMinor: number | null;
  currency: string | null;
  status: string | null;
  method: NormalizedPaymentMethod;
  invoiceId: string | null;
  orderId: string | null;
  createdAt: Date | null;
  error: { code: string | null; description: string | null; source: string | null; step: string | null; reason: string | null };
}
export interface NormalizedRazorpaySubscription {
  id: string;
  status: string;
  planId: string | null;
  customerId: string | null;
  currentStart: number | null;
  currentEnd: number | null;
  chargeAt: number | null;
}
export interface NormalizedRazorpayEvent {
  eventType: string;
  accountId: string | null;
  occurredAt: Date;
  hasAuthoritativeTimestamp: boolean;
  subscription: NormalizedRazorpaySubscription | null;
  payment: NormalizedRazorpayPayment | null;
}

function nullable<T>(value: T | null | undefined): T | null { return value ?? null; }

export function normalizePaymentMethod(method: string | null | undefined): NormalizedPaymentMethod {
  return PAYMENT_METHODS.includes(method as NormalizedPaymentMethod) ? method as NormalizedPaymentMethod : "unknown";
}

export function normalizeRazorpayWebhook(rawBody: Buffer, receivedAt = new Date()): NormalizedRazorpayEvent {
  let decoded: unknown;
  try { decoded = JSON.parse(rawBody.toString("utf8")); }
  catch { throw new AppError(400, "Webhook body is not valid JSON."); }
  const result = envelopeSchema.safeParse(decoded);
  if (!result.success) throw new AppError(400, "Webhook payload is malformed.");
  const subscription = result.data.payload.subscription?.entity;
  const payment = result.data.payload.payment?.entity;
  return {
    eventType: result.data.event,
    accountId: nullable(result.data.account_id),
    occurredAt: result.data.created_at ? new Date(result.data.created_at * 1000) : receivedAt,
    hasAuthoritativeTimestamp: result.data.created_at !== undefined,
    subscription: subscription ? {
      id: subscription.id, status: subscription.status, planId: nullable(subscription.plan_id), customerId: nullable(subscription.customer_id),
      currentStart: nullable(subscription.current_start), currentEnd: nullable(subscription.current_end), chargeAt: nullable(subscription.charge_at),
    } : null,
    payment: payment ? {
      id: nullable(payment.id), amountMinor: nullable(payment.amount), currency: nullable(payment.currency), status: nullable(payment.status), method: normalizePaymentMethod(payment.method), invoiceId: nullable(payment.invoice_id), orderId: nullable(payment.order_id),
      createdAt: payment.created_at ? new Date(payment.created_at * 1000) : null,
      error: { code: nullable(payment.error_code), description: nullable(payment.error_description), source: nullable(payment.error_source), step: nullable(payment.error_step), reason: nullable(payment.error_reason) },
    } : null,
  };
}
