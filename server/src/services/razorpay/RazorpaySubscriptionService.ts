import type { Subscriptions } from "razorpay/dist/types/subscriptions";
import type { CloudDeskPlanKey } from "../../config/cloudDeskPlans.js";
import type { SubscriptionStatus } from "../../domain/types.js";
import { Subscription } from "../../models/Subscription.js";
import { AppError } from "../../utils/AppError.js";
import { normalizeRazorpayError, razorpayClient } from "./RazorpayClient.js";
import { resolveCloudDeskPlan } from "./RazorpayPlanService.js";

export interface SubscriptionCustomerInput { name: string; email: string; contact?: string }

function toDate(timestamp: number | null | undefined): Date | null {
  return typeof timestamp === "number" && timestamp > 0 ? new Date(timestamp * 1000) : null;
}

export function mapRazorpaySubscriptionStatus(status: string): SubscriptionStatus {
  return ["created", "authenticated", "active", "pending", "halted", "cancelled", "completed", "paused"].includes(status)
    ? status as SubscriptionStatus
    : "unknown";
}

export async function fetchRazorpaySubscription(id: string): Promise<Subscriptions.RazorpaySubscription> {
  try {
    return await razorpayClient.subscriptions.fetch(id);
  } catch (error) {
    throw normalizeRazorpayError(error, "Unable to fetch the Razorpay subscription.");
  }
}

export async function createRazorpaySubscription(planKey: CloudDeskPlanKey, customer: SubscriptionCustomerInput) {
  const plan = await resolveCloudDeskPlan(planKey);
  let remote: Subscriptions.RazorpaySubscription;
  try {
    remote = await razorpayClient.subscriptions.create({
      plan_id: plan.razorpayPlanId,
      quantity: 1,
      total_count: 12,
      customer_notify: false,
      notes: { recoveryiq: "true", merchant: "CloudDesk", plan_key: plan.planKey, environment: "hackathon_test" },
    });
  } catch (error) {
    throw normalizeRazorpayError(error, "Razorpay rejected subscription creation.");
  }

  const razorpayCreatedAt = toDate(remote.created_at);
  if (!razorpayCreatedAt) throw new AppError(502, "Razorpay returned a subscription without a valid creation timestamp.");
  return Subscription.create({
    razorpaySubscriptionId: remote.id,
    razorpayPlanId: remote.plan_id,
    razorpayCustomerId: remote.customer_id ?? null,
    customer,
    plan: { name: plan.name, amountMinor: plan.amountMinor, currency: plan.currency },
    status: mapRazorpaySubscriptionStatus(remote.status),
    razorpayCreatedAt,
    razorpayCurrentStartAt: toDate(remote.current_start),
    razorpayCurrentEndAt: toDate(remote.current_end),
    razorpayChargeAt: toDate(remote.charge_at),
  });
}

export async function synchronizeLocalSubscription(localId: string) {
  const local = await Subscription.findById(localId);
  if (!local) throw new AppError(404, "Subscription not found.");
  const remote = await fetchRazorpaySubscription(local.razorpaySubscriptionId);
  local.status = mapRazorpaySubscriptionStatus(remote.status);
  local.razorpayCustomerId = remote.customer_id ?? null;
  local.razorpayPlanId = remote.plan_id;
  local.razorpayCurrentStartAt = toDate(remote.current_start);
  local.razorpayCurrentEndAt = toDate(remote.current_end);
  local.razorpayChargeAt = toDate(remote.charge_at);
  await local.save();
  return local;
}

export async function synchronizeLocalSubscriptionFromRemote(localId: string, remote: Subscriptions.RazorpaySubscription) {
  const local = await Subscription.findById(localId);
  if (!local) throw new AppError(404, "Subscription not found.");
  local.status = mapRazorpaySubscriptionStatus(remote.status);
  local.razorpayCustomerId = remote.customer_id ?? null;
  local.razorpayPlanId = remote.plan_id;
  local.razorpayCurrentStartAt = toDate(remote.current_start);
  local.razorpayCurrentEndAt = toDate(remote.current_end);
  local.razorpayChargeAt = toDate(remote.charge_at);
  await local.save();
  return local;
}
