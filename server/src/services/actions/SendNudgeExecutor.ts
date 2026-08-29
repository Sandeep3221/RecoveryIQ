import type { RecoveryNotificationService } from "../notifications/RecoveryNotificationService.js";
import type { ActionExecutionResult, RecoveryActionExecutionInput, RecoveryActionExecutor } from "./RecoveryActionExecutor.js";

export const RECOVERY_NUDGE_TEMPLATE_VERSION = "recovery-nudge-v1";
function firstName(name: string): string { return name.trim().split(/\s+/)[0] || "there"; }
function amount(amountMinor: number): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amountMinor / 100); }

export class SendNudgeExecutor implements RecoveryActionExecutor {
  constructor(private readonly notifications: RecoveryNotificationService) {}
  async execute(input: RecoveryActionExecutionInput): Promise<ActionExecutionResult> {
    const message = { to: input.customer.email, subject: "Action needed for your CloudDesk subscription", text: `Hi ${firstName(input.customer.name)},\n\nWe could not complete the latest ${amount(input.plan.amountMinor)} payment for your ${input.plan.name} subscription. Please review your payment method when convenient so your subscription can continue.\n\nCloudDesk`, templateVersion: RECOVERY_NUDGE_TEMPLATE_VERSION };
    const delivery = await this.notifications.send(message, input.actionId);
    return { status: "EXECUTED", executedAt: input.now, failureReason: null, executionMode: delivery.deliveryMode, metadata: { deliveryMode: delivery.deliveryMode, deliveryStatus: delivery.deliveryStatus, customerContacted: delivery.customerContacted, templateVersion: message.templateVersion, subject: message.subject, content: message.text, ...(delivery.providerMessageId ? { providerMessageId: delivery.providerMessageId } : {}) } };
  }
}
