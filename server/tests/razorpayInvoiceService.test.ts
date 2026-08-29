import { describe, expect, it } from "vitest";
import { RazorpayInvoiceService } from "../src/services/razorpay/RazorpayInvoiceService.js";

describe("RazorpayInvoiceService", () => {
  it("returns only correlation identifiers", async () => {
    const service = new RazorpayInvoiceService(async () => ({ id: "inv_1", subscription_id: "sub_1", payment_id: "pay_1", order_id: "order_1", customer_details: { email: "private@example.test" } }));
    expect(await service.fetchForCorrelation("inv_1")).toEqual({ invoiceId: "inv_1", subscriptionId: "sub_1", paymentId: "pay_1", orderId: "order_1" });
  });

  it("returns null when the invoice response is invalid or the fetch fails", async () => {
    const invalid = new RazorpayInvoiceService(async () => ({ id: "inv_other" }));
    const failing = new RazorpayInvoiceService(async () => { throw new Error("fixture outage"); });
    expect(await invalid.fetchForCorrelation("inv_1")).toBeNull();
    expect(await failing.fetchForCorrelation("inv_1")).toBeNull();
  });
});
