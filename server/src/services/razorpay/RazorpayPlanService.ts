import type { Plans } from "razorpay/dist/types/plans";
import { cloudDeskPlanList, type CloudDeskPlanConfig, type CloudDeskPlanKey } from "../../config/cloudDeskPlans.js";
import { AppError } from "../../utils/AppError.js";
import { normalizeRazorpayError, razorpayClient } from "./RazorpayClient.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 100;

function note(plan: Plans.RazorPayPlans, key: string): string | undefined {
  const value = plan.notes?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function assertPlanMatches(plan: Plans.RazorPayPlans, expected: CloudDeskPlanConfig): void {
  const conflicts = [
    plan.period !== expected.period && "period",
    plan.interval !== expected.interval && "interval",
    plan.item.amount !== expected.amountMinor && "amount",
    plan.item.currency !== expected.currency && "currency",
    plan.item.name !== expected.name && "name",
    plan.item.description !== expected.description && "description",
    note(plan, "recoveryiq") !== "true" && "recoveryiq note",
    note(plan, "merchant") !== "CloudDesk" && "merchant note",
  ].filter(Boolean);
  if (conflicts.length > 0) throw new AppError(409, `Razorpay plan ${expected.planKey} conflicts on: ${conflicts.join(", ")}.`);
}

export interface ResolvedCloudDeskPlan extends CloudDeskPlanConfig { razorpayPlanId: string }

export async function fetchAllRazorpayPlans(): Promise<Plans.RazorPayPlans[]> {
  const items: Plans.RazorPayPlans[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await razorpayClient.plans.all({ count: PAGE_SIZE, skip: page * PAGE_SIZE });
      items.push(...response.items);
      if (response.items.length < PAGE_SIZE) return items;
    }
  } catch (error) {
    throw normalizeRazorpayError(error, "Unable to fetch configured Razorpay plans.");
  }
  throw new AppError(502, "Razorpay plan pagination exceeded the safe account limit.");
}

export async function resolveCloudDeskPlans(requireAll = true): Promise<ResolvedCloudDeskPlan[]> {
  const plans = await fetchAllRazorpayPlans();
  const resolved = cloudDeskPlanList.flatMap((config) => {
    const tagged = plans.filter((plan) => note(plan, "plan_key") === config.planKey);
    if (tagged.length > 1) throw new AppError(409, `Multiple Razorpay plans use plan_key ${config.planKey}.`);
    if (tagged.length === 0) return [];
    const plan = tagged[0];
    if (!plan) return [];
    assertPlanMatches(plan, config);
    return [{ ...config, razorpayPlanId: plan.id }];
  });
  if (requireAll && resolved.length !== cloudDeskPlanList.length) throw new AppError(503, "CloudDesk Razorpay plans are not configured. Run npm run razorpay:setup-plans.");
  return resolved;
}

export async function resolveCloudDeskPlan(key: CloudDeskPlanKey): Promise<ResolvedCloudDeskPlan> {
  const plans = await resolveCloudDeskPlans(true);
  const plan = plans.find((candidate) => candidate.key === key);
  if (!plan) throw new AppError(503, "Configured Razorpay plan was not found.");
  return plan;
}

export async function setupCloudDeskPlans(): Promise<Array<ResolvedCloudDeskPlan & { disposition: "CREATED" | "REUSED" }>> {
  const existing = await fetchAllRazorpayPlans();
  const output = [];
  for (const config of cloudDeskPlanList) {
    const tagged = existing.filter((plan) => note(plan, "plan_key") === config.planKey);
    if (tagged.length > 1) throw new AppError(409, `Multiple Razorpay plans use plan_key ${config.planKey}.`);
    const found = tagged[0];
    if (found) {
      assertPlanMatches(found, config);
      output.push({ ...config, razorpayPlanId: found.id, disposition: "REUSED" as const });
      continue;
    }
    try {
      const created = await razorpayClient.plans.create({
        period: config.period, interval: config.interval,
        item: { name: config.name, description: config.description, amount: config.amountMinor, currency: config.currency },
        notes: { recoveryiq: "true", merchant: "CloudDesk", plan_key: config.planKey },
      });
      output.push({ ...config, razorpayPlanId: created.id, disposition: "CREATED" as const });
    } catch (error) {
      throw normalizeRazorpayError(error, `Razorpay rejected creation of ${config.planKey}.`);
    }
  }
  return output;
}
