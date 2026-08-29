export const CLOUDDESK_PLAN_KEYS = ["starter", "pro", "business"] as const;
export type CloudDeskPlanKey = (typeof CLOUDDESK_PLAN_KEYS)[number];

export interface CloudDeskPlanConfig {
  key: CloudDeskPlanKey;
  planKey: string;
  name: string;
  description: string;
  amountMinor: number;
  currency: "INR";
  period: "monthly";
  interval: 1;
}

export const cloudDeskPlans: Record<CloudDeskPlanKey, CloudDeskPlanConfig> = {
  starter: { key: "starter", planKey: "cloudesk_starter_v1", name: "CloudDesk Starter", description: "CloudDesk Starter subscription", amountMinor: 29900, currency: "INR", period: "monthly", interval: 1 },
  pro: { key: "pro", planKey: "cloudesk_pro_v1", name: "CloudDesk Pro", description: "CloudDesk Pro subscription", amountMinor: 69900, currency: "INR", period: "monthly", interval: 1 },
  business: { key: "business", planKey: "cloudesk_business_v1", name: "CloudDesk Business", description: "CloudDesk Business subscription", amountMinor: 149900, currency: "INR", period: "monthly", interval: 1 },
};

export const cloudDeskPlanList = CLOUDDESK_PLAN_KEYS.map((key) => cloudDeskPlans[key]);
