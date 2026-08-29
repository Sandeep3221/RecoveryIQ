"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { LocalSubscription } from "@/types";

function amount(value: number): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value / 100); }

export function SubscriptionsList() {
  const [items, setItems] = useState<LocalSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    apiRequest<{ items: LocalSubscription[] }>("/api/v1/subscriptions?limit=100")
      .then((result) => { if (active) setItems(result.items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Subscriptions could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function sync(id: string): Promise<void> {
    setSyncing(id); setError(null);
    try {
      const result = await apiRequest<{ subscription: LocalSubscription }>(`/api/v1/subscriptions/${id}/sync`, { method: "POST" });
      setItems((current) => current.map((item) => item._id === id ? result.subscription : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Subscription could not be synchronized."); }
    finally { setSyncing(null); }
  }
  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-white" aria-label="Loading subscriptions" />;
  return <>{error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    {items.length === 0 ? <div className="rounded-xl border border-[var(--line)] bg-white p-7"><h2 className="font-semibold">No local subscriptions yet.</h2><p className="mt-2 text-sm text-[var(--muted)]">Create one from the CloudDesk plans page.</p><a href="/subscribe" className="mt-5 inline-flex text-sm font-semibold text-[var(--accent)]">Choose a plan</a></div> :
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-white"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="border-b border-[var(--line)] text-[var(--muted)]"><tr>{["Customer", "Plan", "Amount", "Razorpay Subscription ID", "Status", "Last Failure", "Recovery Case", ""].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item._id} className="border-b border-[var(--line)] last:border-0"><td className="px-4 py-4"><p className="font-medium">{item.customer.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.customer.email}</p></td><td className="px-4 py-4">{item.plan.name}</td><td className="px-4 py-4">{amount(item.plan.amountMinor)}</td><td className="px-4 py-4 font-mono text-xs">{item.razorpaySubscriptionId}</td><td className="px-4 py-4 font-semibold uppercase">{item.status}</td><td className="px-4 py-4 text-[var(--muted)]">{item.lastFailureAt ? new Date(item.lastFailureAt).toLocaleString() : "None"}</td><td className="px-4 py-4">{item.openRecoveryCase ? <span className="font-semibold text-[var(--accent)]">Open</span> : "None"}</td><td className="px-4 py-4 text-right"><button onClick={() => void sync(item._id)} disabled={syncing === item._id} className="rounded-xl border border-[var(--line)] px-3 py-2 font-semibold disabled:opacity-50 active:translate-y-px">{syncing === item._id ? "Syncing" : "Sync"}</button></td></tr>)}</tbody></table></div>}
  </>;
}
