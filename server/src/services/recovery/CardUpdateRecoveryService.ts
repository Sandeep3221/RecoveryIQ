import { env } from "../../config/env.js";
import { AuditEvent } from "../../models/AuditEvent.js";
import { RecoveryCase } from "../../models/RecoveryCase.js";
import { Subscription } from "../../models/Subscription.js";
import { AppError } from "../../utils/AppError.js";
import { hashRecoveryToken } from "../actions/RequestCardUpdateExecutor.js";
import { verifySubscriptionAuthorizationSignature } from "../razorpay/RazorpaySignatureService.js";

function locateAction(recoveryCase: InstanceType<typeof RecoveryCase>, tokenHash: string) {
  return recoveryCase.actions.find((item) => item.type === "REQUEST_CARD_UPDATE" && item.metadata?.purpose === "CARD_UPDATE" && item.metadata?.tokenHash === tokenHash);
}
async function session(token: string) {
  const tokenHash = hashRecoveryToken(token);
  const recoveryCase = await RecoveryCase.findOne({ actions: { $elemMatch: { type: "REQUEST_CARD_UPDATE", "metadata.purpose": "CARD_UPDATE", "metadata.tokenHash": tokenHash } } });
  if (!recoveryCase) throw new AppError(404, "Card update recovery session is invalid.");
  const action = locateAction(recoveryCase, tokenHash);
  if (!action) throw new AppError(404, "Card update recovery session is invalid.");
  if (action.metadata?.usedAt || action.status === "EXECUTED") throw new AppError(409, "Card update recovery session has already been used.");
  if (action.status !== "PENDING" || !action.metadata?.expiresAt || new Date(action.metadata.expiresAt as string | Date).getTime() <= Date.now()) throw new AppError(410, "Card update recovery session has expired.");
  const subscription = await Subscription.findById(recoveryCase.subscriptionId);
  if (!subscription) throw new AppError(404, "Subscription not found.");
  if (!subscription.plan) throw new AppError(409, "Subscription plan details are unavailable.");
  return { recoveryCase, action, subscription };
}

export async function getCardUpdateRecoverySession(token: string) {
  const { action, subscription } = await session(token);
  const plan = subscription.plan;
  if (!plan) throw new AppError(409, "Subscription plan details are unavailable.");
  return { brand: "CloudDesk", plan: { name: plan.name, amountMinor: plan.amountMinor, currency: plan.currency }, expiresAt: action.metadata!.expiresAt, checkout: { key: env.RAZORPAY_KEY_ID, subscription_id: subscription.razorpaySubscriptionId, subscription_card_change: true, name: "CloudDesk", description: `Update payment card for ${plan.name}` } };
}

export async function verifyCardUpdateRecovery(input: { token: string; razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }, now = new Date()) {
  const { recoveryCase, action, subscription } = await session(input.token);
  if (input.razorpay_subscription_id !== subscription.razorpaySubscriptionId) throw new AppError(400, "Card update subscription does not match the recovery session.");
  if (!verifySubscriptionAuthorizationSignature(input.razorpay_payment_id, subscription.razorpaySubscriptionId, input.razorpay_signature)) throw new AppError(400, "Invalid Razorpay card update signature.");
  await RecoveryCase.updateOne({ _id: recoveryCase._id, "actions.actionId": action.actionId, "actions.status": "PENDING" }, { $set: { "actions.$.status": "EXECUTED", "actions.$.executedAt": now, "actions.$.metadata.usedAt": now, "actions.$.metadata.cardUpdateCompleted": true, status: "ACTION_EXECUTED" } });
  await AuditEvent.findOneAndUpdate({ recoveryCaseId: recoveryCase._id, eventType: "CARD_UPDATE_COMPLETED", "metadata.actionId": action.actionId }, { $set: { razorpaySubscriptionId: recoveryCase.razorpaySubscriptionId, actor: "CUSTOMER", title: "Card update interaction verified", metadata: { actionId: action.actionId, razorpayPaymentId: input.razorpay_payment_id }, occurredAt: now }, $setOnInsert: { recoveryCaseId: recoveryCase._id, eventType: "CARD_UPDATE_COMPLETED" } }, { upsert: true });
  return { caseId: recoveryCase.id, caseStatus: "ACTION_EXECUTED", actionId: action.actionId, actionStatus: "EXECUTED", recovered: false };
}
