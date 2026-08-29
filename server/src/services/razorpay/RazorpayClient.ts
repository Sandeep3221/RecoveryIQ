import Razorpay from "razorpay";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";

export const razorpayClient = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });

interface RazorpayErrorShape {
  statusCode?: unknown;
  error?: { description?: unknown };
}

export function normalizeRazorpayError(error: unknown, fallback: string): AppError {
  const candidate = error as RazorpayErrorShape;
  const status = typeof candidate.statusCode === "number" && candidate.statusCode >= 400 && candidate.statusCode < 500 ? 502 : 500;
  const description = typeof candidate.error?.description === "string" ? candidate.error.description : undefined;
  console.error("Razorpay request failed", { statusCode: candidate.statusCode, description });
  return new AppError(status, fallback);
}
