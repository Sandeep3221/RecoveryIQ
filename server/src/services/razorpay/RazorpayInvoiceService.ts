import { razorpayClient } from "./RazorpayClient.js";

export interface CorrelationInvoice {
  invoiceId: string;
  subscriptionId: string | null;
  paymentId: string | null;
  orderId: string | null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class RazorpayInvoiceService {
  constructor(
    private readonly fetchInvoice: (invoiceId: string) => Promise<unknown> = (invoiceId) => razorpayClient.invoices.fetch(invoiceId),
  ) {}

  async fetchForCorrelation(invoiceId: string): Promise<CorrelationInvoice | null> {
    try {
      const raw = await this.fetchInvoice(invoiceId);
      if (!raw || typeof raw !== "object") return null;
      const invoice = raw as Record<string, unknown>;
      const authoritativeId = nullableString(invoice.id);
      if (!authoritativeId || authoritativeId !== invoiceId) return null;
      return {
        invoiceId: authoritativeId,
        subscriptionId: nullableString(invoice.subscription_id),
        paymentId: nullableString(invoice.payment_id),
        orderId: nullableString(invoice.order_id),
      };
    } catch (error) {
      console.error("Razorpay invoice correlation lookup failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        invoiceId,
      });
      return null;
    }
  }
}

export const razorpayInvoiceService = new RazorpayInvoiceService();
