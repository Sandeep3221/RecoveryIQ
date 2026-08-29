"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { CloudDeskPlan, LocalSubscription, RazorpayCheckoutResponse } from "@/types";

type FlowStatus = "idle" | "creating" | "authorizing" | "verifying" | "verified";
interface CustomerForm { name: string; email: string; contact: string }
interface CreateResponse { subscription: LocalSubscription; checkout: { keyId: string; subscriptionId: string; name: string; description: string } }

function formatAmount(amountMinor: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amountMinor / 100);
}

export function SubscribeFlow() {
  const [plans, setPlans] = useState<CloudDeskPlan[]>([]);
  const [selected, setSelected] = useState<CloudDeskPlan | null>(null);
  const [form, setForm] = useState<CustomerForm>({ name: "", email: "", contact: "" });
  const [status, setStatus] = useState<FlowStatus>("idle");
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<LocalSubscription | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(true);

  useEffect(() => {
    apiRequest<{ items: CloudDeskPlan[] }>("/api/v1/plans")
      .then(({ items }) => setPlans(items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Plans could not be loaded."))
      .finally(() => setLoadingPlans(false));
  }, []);

  async function verify(response: RazorpayCheckoutResponse): Promise<void> {
    setStatus("verifying");
    try {
      const result = await apiRequest<{ message: string; subscription: LocalSubscription }>("/api/v1/subscriptions/verify-authorization", { method: "POST", body: JSON.stringify(response) });
      setVerified(result.subscription);
      setStatus("verified");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authorization verification failed.");
      setStatus("idle");
    }
  }

  async function beginCheckout(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    if (!scriptReady || !window.Razorpay) { setError("Razorpay Checkout is still loading. Try again shortly."); return; }
    setError(null);
    setStatus("creating");
    try {
      const result = await apiRequest<CreateResponse>("/api/v1/subscriptions", {
        method: "POST",
        body: JSON.stringify({ planKey: selected.key, customer: { name: form.name, email: form.email, ...(form.contact ? { contact: form.contact } : {}) } }),
      });
      setStatus("authorizing");
      const checkout = new window.Razorpay({
        key: result.checkout.keyId,
        subscription_id: result.checkout.subscriptionId,
        name: result.checkout.name,
        description: result.checkout.description,
        prefill: { name: form.name, email: form.email, ...(form.contact ? { contact: form.contact } : {}) },
        handler: verify,
        modal: { ondismiss: () => setStatus("idle") },
      });
      checkout.open();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Subscription could not be created.");
      setStatus("idle");
    }
  }

  if (verified) return <div className="rounded-xl border border-[var(--line)] bg-white p-7">
    <p className="text-sm font-semibold text-[var(--accent)]">Subscription authorization verified.</p>
    <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
      <div><dt className="text-[var(--muted)]">Plan</dt><dd className="mt-1 font-semibold">{verified.plan.name}</dd></div>
      <div><dt className="text-[var(--muted)]">Razorpay Subscription</dt><dd className="mt-1 break-all font-mono text-xs">{verified.razorpaySubscriptionId}</dd></div>
      <div><dt className="text-[var(--muted)]">Status</dt><dd className="mt-1 font-semibold uppercase">{verified.status}</dd></div>
    </dl>
    <a href="/subscriptions" className="mt-7 inline-flex rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white active:translate-y-px">View Subscriptions</a>
  </div>;

  return <>
    <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onLoad={() => setScriptReady(true)} onError={() => setError("Razorpay Checkout could not be loaded.")} />
    {error && <p role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    {loadingPlans ? <div className="grid gap-4 md:grid-cols-3" aria-label="Loading plans">{[1, 2, 3].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl bg-white" />)}</div> :
      <div className="grid gap-4 md:grid-cols-3">{plans.map((plan) => <article key={plan.key} className={`rounded-xl border bg-white p-6 ${selected?.key === plan.key ? "border-[var(--accent)]" : "border-[var(--line)]"}`}>
        <h2 className="text-lg font-semibold">{plan.name.replace("CloudDesk ", "")}</h2>
        <p className="mt-5 text-3xl font-semibold tracking-tight">{formatAmount(plan.amountMinor)}<span className="text-sm font-normal text-[var(--muted)]">/month</span></p>
        <button type="button" onClick={() => { setSelected(plan); setError(null); }} className="mt-7 w-full rounded-xl border border-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent)] active:translate-y-px">Subscribe</button>
      </article>)}</div>}
    {selected && <form onSubmit={beginCheckout} className="mt-8 max-w-2xl rounded-xl border border-[var(--line)] bg-white p-6">
      <h2 className="text-lg font-semibold">Authorize {selected.name}</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Name<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" /></label>
        <label className="text-sm font-medium">Email<input required type="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" /></label>
        <label className="text-sm font-medium sm:col-span-2">Contact <span className="font-normal text-[var(--muted)]">(optional)</span><input type="tel" minLength={7} maxLength={20} value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} className="mt-2 w-full rounded-xl border border-[var(--line)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" /></label>
      </div>
      <button disabled={status !== "idle"} className="mt-6 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 active:translate-y-px">{status === "creating" ? "Creating subscription" : status === "authorizing" ? "Opening Checkout" : status === "verifying" ? "Verifying authorization" : "Continue to Razorpay"}</button>
    </form>}
  </>;
}
