import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyRazorpayWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}
