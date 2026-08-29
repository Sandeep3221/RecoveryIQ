import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

export function verifySubscriptionAuthorizationSignature(paymentId: string, authoritativeSubscriptionId: string, receivedSignature: string): boolean {
  const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${paymentId}|${authoritativeSubscriptionId}`)
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(receivedSignature, "hex");
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(expected, received);
}
