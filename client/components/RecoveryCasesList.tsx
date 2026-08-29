"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { LocalRecoveryCase } from "@/types";
import Link from "next/link";

function amount(value: number): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value / 100); }

export function RecoveryCasesList() {
  const [items, setItems] = useState<LocalRecoveryCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    apiRequest<{ items: LocalRecoveryCase[] }>("/api/v1/recovery-cases?limit=100")
      .then((result) => { if (active) setItems(result.items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Recovery cases could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-white" aria-label="Loading recovery cases" />;
  if (error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>;
  if (items.length === 0) return <div className="rounded-xl border border-[var(--line)] bg-white p-7"><h2 className="font-semibold">No recovery cases detected.</h2><p className="mt-2 text-sm text-[var(--muted)]">Cases appear after verified Razorpay pending or halted events.</p></div>;
  return <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-white"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-[var(--line)] text-[var(--muted)]"><tr>{["Customer", "Plan", "Revenue At Risk", "Status", "Opened At"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item._id} className="border-b border-[var(--line)] last:border-0"><td className="px-4 py-4 font-medium"><Link className="hover:text-[var(--accent)]" href={`/recovery-cases/${item._id}`}>{item.subscriptionId?.customer.name ?? "Unavailable"}</Link></td><td className="px-4 py-4">{item.subscriptionId?.plan.name ?? "Unavailable"}</td><td className="px-4 py-4">{amount(item.revenueAtRiskMinor)}</td><td className="px-4 py-4 font-semibold uppercase">{item.status}</td><td className="px-4 py-4 text-[var(--muted)]">{new Date(item.openedAt).toLocaleString()}</td></tr>)}</tbody></table></div>;
}
