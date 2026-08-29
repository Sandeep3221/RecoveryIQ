import type { Payments } from "razorpay/dist/types/payments";
import { razorpayClient } from "./RazorpayClient.js";

export type DowntimeStatus = "scheduled" | "started" | "updated" | "resolved" | "unknown";
export type DowntimeSeverity = "low" | "medium" | "high" | null;
export type DowntimeMatchLevel = "EXACT" | "METHOD_ONLY" | "NONE" | "UNKNOWN";

export interface DowntimeCandidate {
  downtimeId: string;
  method: string;
  status: DowntimeStatus;
  severity: DowntimeSeverity;
  scheduled: boolean | null;
  begin: Date | null;
  end: Date | null;
  instrument: Record<string, unknown> | null;
}

export interface DowntimeContext {
  checked: boolean;
  active: boolean;
  matched: boolean;
  matchLevel: DowntimeMatchLevel;
  method: string | null;
  severity: DowntimeSeverity;
  downtimeId: string | null;
  checkedAt: Date;
  candidatesFound: number;
  explanation: string;
}

type DowntimeFetcher = () => Promise<{ items: Array<Payments.RazorpayPaymentDowntime> }>;
const CACHE_TTL_MS = 30_000;

function date(value: unknown): Date | null { return typeof value === "number" && value > 0 ? new Date(value * 1000) : null; }
function status(value: unknown): DowntimeStatus { return ["scheduled", "started", "updated", "resolved"].includes(String(value)) ? String(value) as DowntimeStatus : "unknown"; }
function severity(value: unknown): DowntimeSeverity { return ["low", "medium", "high"].includes(String(value)) ? String(value) as Exclude<DowntimeSeverity, null> : null; }
function safeInstrument(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const allowed = ["bank", "psp", "vpa_handle", "wallet"].flatMap((key) => typeof source[key] === "string" ? [[key, source[key]]] : []);
  return allowed.length ? Object.fromEntries(allowed) : {};
}

export function normalizeDowntimeCandidates(items: readonly unknown[]): DowntimeCandidate[] {
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    if (typeof source.id !== "string" || typeof source.method !== "string") return [];
    return [{ downtimeId: source.id, method: source.method.toLowerCase(), status: status(source.status), severity: severity(source.severity), scheduled: typeof source.scheduled === "boolean" ? source.scheduled : null, begin: date(source.begin), end: date(source.end), instrument: safeInstrument(source.instrument) }];
  });
}

function isActive(candidate: DowntimeCandidate): boolean { return candidate.status === "started" || candidate.status === "updated"; }
function isBroad(candidate: DowntimeCandidate): boolean {
  if (!candidate.instrument || Object.keys(candidate.instrument).length === 0) return true;
  return candidate.method === "upi" && String(candidate.instrument.vpa_handle).toUpperCase() === "ALL";
}

export function matchDowntime(paymentMethod: string, candidates: DowntimeCandidate[], checkedAt = new Date()): DowntimeContext {
  const method = paymentMethod.trim().toLowerCase();
  if (!method || method === "unknown") return { checked: true, active: false, matched: false, matchLevel: "UNKNOWN", method: method || null, severity: null, downtimeId: null, checkedAt, candidatesFound: candidates.length, explanation: "Downtime data was retrieved, but the failed payment method is unknown, so applicability cannot be evaluated." };
  const activeForMethod = candidates.filter((candidate) => candidate.method === method && isActive(candidate));
  const broad = activeForMethod.find(isBroad);
  if (broad) return { checked: true, active: true, matched: true, matchLevel: "EXACT", method, severity: broad.severity, downtimeId: broad.downtimeId, checkedAt, candidatesFound: activeForMethod.length, explanation: `Razorpay reports active broad ${method} downtime that applies at the payment-method level.` };
  const specific = activeForMethod[0];
  if (specific) return { checked: true, active: false, matched: false, matchLevel: "METHOD_ONLY", method, severity: specific.severity, downtimeId: specific.downtimeId, checkedAt, candidatesFound: activeForMethod.length, explanation: `An active ${method} downtime exists, but RecoveryIQ does not have sufficient non-sensitive instrument information to prove that it applies to this payment.` };
  return { checked: true, active: false, matched: false, matchLevel: "NONE", method, severity: null, downtimeId: null, checkedAt, candidatesFound: 0, explanation: `Razorpay reports no active downtime relevant to payment method ${method}.` };
}

export class RazorpayDowntimeService {
  private cache: { expiresAt: number; candidates: DowntimeCandidate[] } | null = null;
  constructor(private readonly fetcher: DowntimeFetcher = () => razorpayClient.payments.fetchPaymentDowntime()) {}

  async getContext(paymentMethod: string, now = new Date()): Promise<DowntimeContext> {
    try {
      let candidates: DowntimeCandidate[];
      if (this.cache && this.cache.expiresAt > now.getTime()) candidates = this.cache.candidates;
      else {
        const response = await this.fetcher();
        candidates = normalizeDowntimeCandidates(response.items);
        this.cache = { candidates, expiresAt: now.getTime() + CACHE_TTL_MS };
      }
      return matchDowntime(paymentMethod, candidates, now);
    } catch (error) {
      console.error("Razorpay downtime lookup failed", error instanceof Error ? { name: error.name, message: error.message } : { message: "Unknown error" });
      return { checked: false, active: false, matched: false, matchLevel: "UNKNOWN", method: paymentMethod === "unknown" ? null : paymentMethod, severity: null, downtimeId: null, checkedAt: now, candidatesFound: 0, explanation: "Razorpay downtime lookup failed; current downtime state is unknown." };
    }
  }
}

export const razorpayDowntimeService = new RazorpayDowntimeService();
