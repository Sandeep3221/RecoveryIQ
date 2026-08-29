"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { RecoveryMetricsView } from "@/types";
function money(value: number): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value / 100); }

export function RecoveryMetricsSummary() {
  const [metrics, setMetrics] = useState<RecoveryMetricsView | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiRequest<RecoveryMetricsView>("/api/v1/recovery-metrics").then(setMetrics).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Recovery metrics are unavailable.")); }, []);
  if (error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>;
  if (!metrics) return <div className="h-28 animate-pulse rounded-xl bg-white" aria-label="Loading recovery metrics" />;
  const cards = [["Revenue At Risk", money(metrics.totalRevenueAtRiskMinor)], ["Observed Revenue Recovered", money(metrics.observedRecoveredRevenueMinor)], ["Still At Risk", money(metrics.unresolvedRevenueMinor)], ["Recovery Cases", String(metrics.totalCases)], ["Recovered Cases", String(metrics.recoveredCases)], ["Revenue Recovery Rate", `${(metrics.revenueRecoveryRate * 100).toFixed(1)}%`]];
  return <><section aria-label="Live Razorpay recovery metrics" className="grid overflow-hidden rounded-2xl border border-[var(--line)] bg-white sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, value]) => <article key={label} className="border-b border-r border-[var(--line)] p-5 last:border-b-0 lg:p-6"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p></article>)}</section><p className="mt-4 max-w-3xl text-xs leading-5 text-[var(--muted)]">Observed recovery is based on authoritative Razorpay payment evidence. Recovery association describes sequence and correlation; it does not establish causal uplift.</p></>;
}
