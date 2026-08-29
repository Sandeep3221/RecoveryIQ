import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CLIENT_URL: z.string().url(),
  RAZORPAY_KEY_ID: z.string().min(1).refine((value) => value.startsWith("rzp_test_"), "Test Mode key required"),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  RECOVERY_SCORER: z.enum(["heuristic", "logistic"]).default("heuristic"),
  RECOVERY_NOTIFICATION_MODE: z.enum(["simulation"]).default("simulation"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed");
}
export const env = parsed.data;
