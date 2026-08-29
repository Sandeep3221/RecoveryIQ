import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import type { ActionExecutionResult, RecoveryActionExecutionInput, RecoveryActionExecutor } from "./RecoveryActionExecutor.js";

export function hashRecoveryToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export class RequestCardUpdateExecutor implements RecoveryActionExecutor {
  async execute(input: RecoveryActionExecutionInput): Promise<ActionExecutionResult> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(input.now.getTime() + 60 * 60 * 1000);
    return { status: "PENDING", executedAt: null, failureReason: null, executionMode: "customer", metadata: { purpose: "CARD_UPDATE", tokenHash: hashRecoveryToken(token), expiresAt, caseId: input.caseId, actionId: input.actionId, razorpaySubscriptionId: input.razorpaySubscriptionId, customerContacted: false }, recoveryUrl: `${env.CLIENT_URL}/recover/card/${token}` };
  }
}
