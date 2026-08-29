import type { Payments } from "razorpay/dist/types/payments";
import { describe, expect, it } from "vitest";
import { matchDowntime, normalizeDowntimeCandidates, RazorpayDowntimeService } from "../src/services/razorpay/RazorpayDowntimeService.js";

function remote(overrides: Partial<Payments.RazorpayPaymentDowntime> = {}): Payments.RazorpayPaymentDowntime {
  return { id: "down_fixture", entity: "payment.downtime", method: "card", begin: 1_700_000_000, end: null, status: "started", scheduled: false, severity: "high", instrument: {}, created_at: 1_700_000_000, updated_at: 1_700_000_000, ...overrides };
}

describe("RazorpayDowntimeService", () => {
  it.each(["started", "updated"] as const)("treats %s broad downtime as active", (status) => {
    const result = matchDowntime("card", normalizeDowntimeCandidates([remote({ status: status as Payments.RazorpayPaymentDowntime["status"] })]));
    expect(result).toMatchObject({ checked: true, active: true, matched: true, matchLevel: "EXACT", severity: "high" });
  });

  it("ignores resolved, scheduled, and method-mismatched candidates", () => {
    expect(matchDowntime("card", normalizeDowntimeCandidates([remote({ status: "resolved" })])).matchLevel).toBe("NONE");
    expect(matchDowntime("card", normalizeDowntimeCandidates([remote({ status: "scheduled" })])).active).toBe(false);
    expect(matchDowntime("upi", normalizeDowntimeCandidates([remote()])).matchLevel).toBe("NONE");
  });

  it("reports instrument-specific method correlation as uncertain", () => {
    const result = matchDowntime("card", normalizeDowntimeCandidates([remote({ instrument: { bank: "HDFC" }, severity: "medium" })]));
    expect(result).toMatchObject({ active: false, matched: false, matchLevel: "METHOD_ONLY", severity: "medium" });
  });

  it("recognizes broad UPI ALL evidence and maps severity", () => {
    const result = matchDowntime("upi", normalizeDowntimeCandidates([remote({ method: "upi", instrument: { vpa_handle: "ALL" }, severity: "low" })]));
    expect(result).toMatchObject({ active: true, matchLevel: "EXACT", severity: "low" });
  });

  it("returns checked=false when the API fails", async () => {
    const service = new RazorpayDowntimeService(async () => { throw new Error("fixture outage"); });
    expect(await service.getContext("card")).toMatchObject({ checked: false, active: false, matched: false, matchLevel: "UNKNOWN" });
  });

  it("skips malformed candidates without crashing", () => {
    expect(normalizeDowntimeCandidates([null, {}, { id: 4, method: "card" }, { id: "ok", method: "card", status: "future", severity: "critical", instrument: { secret: "discard" } }])).toEqual([
      expect.objectContaining({ downtimeId: "ok", status: "unknown", severity: null, instrument: {} }),
    ]);
  });
});
