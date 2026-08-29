import { setupCloudDeskPlans } from "../src/services/razorpay/RazorpayPlanService.js";

async function main(): Promise<void> {
  const plans = await setupCloudDeskPlans();
  for (const plan of plans) console.info(`${plan.planKey} ${plan.razorpayPlanId} ${plan.amountMinor} ${plan.disposition}`);
}

main().catch((error: unknown) => {
  console.error("Razorpay plan setup failed", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
