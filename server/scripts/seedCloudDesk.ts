import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { Subscription } from "../src/models/Subscription.js";

const subscriptions = [
  ["sub_demo_001", "Aarav Mehta", "aarav.mehta@example.test", "Starter", 29900, "active"],
  ["sub_demo_002", "Diya Shah", "diya.shah@example.test", "Pro", 69900, "active"],
  ["sub_demo_003", "Kabir Rao", "kabir.rao@example.test", "Business", 149900, "pending"],
  ["sub_demo_004", "Meera Iyer", "meera.iyer@example.test", "Starter", 29900, "active"],
  ["sub_demo_005", "Rohan Nair", "rohan.nair@example.test", "Pro", 69900, "halted"],
  ["sub_demo_006", "Ananya Bose", "ananya.bose@example.test", "Business", 149900, "active"],
  ["sub_demo_007", "Vivaan Kapoor", "vivaan.kapoor@example.test", "Starter", 29900, "pending"],
  ["sub_demo_008", "Ishita Sen", "ishita.sen@example.test", "Pro", 69900, "active"],
  ["sub_demo_009", "Arjun Pillai", "arjun.pillai@example.test", "Business", 149900, "halted"],
  ["sub_demo_010", "Naina Verma", "naina.verma@example.test", "Pro", 69900, "pending"],
] as const;

async function seed(): Promise<void> {
  await connectDatabase();
  const razorpayCreatedAt = new Date("2026-01-15T00:00:00.000Z");
  const operations = subscriptions.map(([id, name, email, planName, amountMinor, status]) => ({
    updateOne: {
      filter: { razorpaySubscriptionId: id },
      update: { $setOnInsert: { razorpaySubscriptionId: id, razorpayPlanId: null, razorpayCustomerId: null, customer: { name, email }, plan: { name: planName, amountMinor, currency: "INR" as const }, status, statistics: { successfulPayments: 0, failedPayments: 0, recoveredPayments: 0, consecutiveFailures: 0, nudgesSent: 0 }, razorpayCreatedAt } },
      upsert: true,
    },
  }));
  const result = await Subscription.bulkWrite(operations);
  const total = await Subscription.countDocuments({ razorpaySubscriptionId: { $in: subscriptions.map(([id]) => id) } });
  console.info(`CloudDesk seed complete: ${result.upsertedCount} inserted, ${total} demo subscriptions present.`);
}

seed().catch((error: unknown) => { console.error("CloudDesk seed failed", error); process.exitCode = 1; }).finally(() => disconnectDatabase());
