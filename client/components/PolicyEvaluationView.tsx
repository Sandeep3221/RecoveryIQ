"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";

const strategyOrder = ["RECOVERYIQ_LOGISTIC_POLICY", "HEURISTIC_POLICY", "NAIVE_RETRY_FIRST", "NAIVE_NUDGE_FIRST"] as const;
const labels: Record<string, string> = {
  RECOVERYIQ_LOGISTIC_POLICY: "RecoveryIQ Logistic + Policy",
  HEURISTIC_POLICY: "Heuristic + Policy",
  NAIVE_RETRY_FIRST: "Retry First",
  NAIVE_NUDGE_FIRST: "Nudge First",
};
const actions = ["WAIT_NATIVE_RETRY", "SEND_NUDGE", "REQUEST_CARD_UPDATE", "STOP_AND_ESCALATE"] as const;

interface StrategyMetric {
  expectedRecoveredRevenueMinor: number;
  realizedRecoveredRevenueMinor: number;
  expectedRevenueRecoveryRate: number;
  realizedRevenueRecoveryRate: number;
  totalCustomerInterventions: number;
  customerInterventionsPer100Cases: number;
  actionDistribution: Record<string, number>;
  perCategory: Record<string, { caseCount: number; expectedRecoveryRate: number; realizedRecoveryRate: number; dominantSelectedAction: string }>;
}
interface Evaluation {
  evaluationVersion: string;
  datasetVersion: string;
  seed: number;
  episodeCount: number;
  datasetHash: string;
  strategies: Record<string, StrategyMetric>;
  comparisons: Record<string, { simulatedExpectedRevenueUpliftRate: number | null }>;
  policySafety: { hardRuleDecisionRate: number; modelRankedDecisionRate: number; rawModelWinnerBlockedRate: number };
}

const money = (minor: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(minor / 100);
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

export function PolicyEvaluationView() {
  const [evaluation, setEvaluation] = useState<Evaluation | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => { apiRequest<{ evaluation: Evaluation | null }>("/api/v1/evaluation/latest").then((value) => setEvaluation(value.evaluation)).catch((reason: Error) => setError(reason.message)); }, []);
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert">{error}</div>;
  if (evaluation === undefined) return <div className="h-40 animate-pulse rounded-2xl bg-white" aria-label="Loading evaluation" />;
  if (evaluation === null) return <div className="rounded-2xl border border-[var(--line)] bg-white p-6"><h2 className="text-lg font-semibold">No persisted evaluation yet</h2><p className="mt-2 text-sm text-[var(--muted)]">Run the offline policy evaluation with <code>--persist</code>. This page never starts an evaluation.</p></div>;
  const recoveryIQ = evaluation.strategies.RECOVERYIQ_LOGISTIC_POLICY;
  const comparisonNames = [["NAIVE_RETRY_FIRST", "Retry First"], ["NAIVE_NUDGE_FIRST", "Nudge First"], ["HEURISTIC_POLICY", "Heuristic + Policy"]] as const;
  return <div className="space-y-8">
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6" aria-labelledby="simulation-boundary"><p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-900">Controlled evaluation boundary</p><h2 id="simulation-boundary" className="mt-2 text-2xl font-semibold text-amber-950">Simulation only</h2><p className="mt-3 max-w-3xl leading-7 text-amber-950">These results do not represent actual merchant revenue uplift. Every figure comes from {evaluation.datasetVersion} and remains separate from live Razorpay observations.</p></section>
    {recoveryIQ && <section aria-labelledby="evaluation-highlights"><h2 id="evaluation-highlights" className="text-xl font-semibold">RecoveryIQ simulated results</h2><dl className="mt-4 grid overflow-hidden rounded-2xl border border-[var(--line)] bg-white sm:grid-cols-2 lg:grid-cols-4"><div className="border-b border-r border-[var(--line)] p-5"><dt className="text-sm text-[var(--muted)]">Expected simulated revenue recovered</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{money(recoveryIQ.expectedRecoveredRevenueMinor)}</dd></div><div className="border-b border-r border-[var(--line)] p-5"><dt className="text-sm text-[var(--muted)]">Expected simulated recovery rate</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{percent(recoveryIQ.expectedRevenueRecoveryRate)}</dd></div><div className="border-b border-r border-[var(--line)] p-5"><dt className="text-sm text-[var(--muted)]">Realized simulated recovery rate</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{percent(recoveryIQ.realizedRevenueRecoveryRate)}</dd></div><div className="p-5"><dt className="text-sm text-[var(--muted)]">Customer interventions</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{recoveryIQ.totalCustomerInterventions.toLocaleString("en-IN")}</dd></div></dl></section>}
    <section aria-labelledby="simulated-uplift-title"><h2 id="simulated-uplift-title" className="text-xl font-semibold">Simulated expected revenue comparison</h2><div className="mt-4 grid gap-4 md:grid-cols-3">{comparisonNames.map(([key, label]) => { const uplift = evaluation.comparisons[key]?.simulatedExpectedRevenueUpliftRate; return <article key={key} className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-sm text-[var(--muted)]">RecoveryIQ vs {label}</p><p className="mt-3 text-3xl font-semibold tabular-nums">{uplift === null || uplift === undefined ? "Unavailable" : `${uplift >= 0 ? "+" : ""}${percent(uplift)}`}</p><p className="mt-2 text-xs font-bold text-[var(--accent)]">SIMULATED expected revenue uplift</p></article>; })}</div></section>
    <section aria-labelledby="comparison-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 id="comparison-title" className="text-xl font-semibold">Strategy comparison</h2><p className="mt-1 text-sm text-[var(--muted)]">{evaluation.episodeCount.toLocaleString("en-IN")} fresh contexts · seed {evaluation.seed}</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold tracking-wide text-amber-900">SIMULATION ONLY</span></div>
      <div className="grid gap-4 md:grid-cols-2">
        {strategyOrder.map((name) => { const metric = evaluation.strategies[name]; if (!metric) return null; const uplift = name === "RECOVERYIQ_LOGISTIC_POLICY" ? evaluation.comparisons.NAIVE_RETRY_FIRST?.simulatedExpectedRevenueUpliftRate : null; return <article key={name} className={`rounded-2xl border p-6 ${name === "RECOVERYIQ_LOGISTIC_POLICY" ? "border-emerald-300 bg-emerald-50/60" : "border-[var(--line)] bg-white"}`}>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">{name === "RECOVERYIQ_LOGISTIC_POLICY" ? "Production strategy" : "Comparison strategy"}</p><h3 className="mt-2 text-xl font-semibold">{labels[name]}</h3>
          <dl className="mt-5 grid grid-cols-2 gap-4"><div><dt className="text-xs text-[var(--muted)]">Simulated expected recovered</dt><dd className="mt-1 text-xl font-semibold">{money(metric.expectedRecoveredRevenueMinor)}</dd></div><div><dt className="text-xs text-[var(--muted)]">Simulated expected rate</dt><dd className="mt-1 text-xl font-semibold">{percent(metric.expectedRevenueRecoveryRate)}</dd></div><div><dt className="text-xs text-[var(--muted)]">Simulated realized recovered</dt><dd className="mt-1 font-semibold">{money(metric.realizedRecoveredRevenueMinor)}</dd></div><div><dt className="text-xs text-[var(--muted)]">Customer interventions</dt><dd className="mt-1 font-semibold">{metric.totalCustomerInterventions.toLocaleString("en-IN")}</dd></div></dl>
          {uplift !== null && uplift !== undefined && <p className="mt-5 rounded-lg bg-white/80 px-3 py-2 text-sm font-semibold">{uplift >= 0 ? "+" : ""}{percent(uplift)} SIMULATED expected recovery vs Retry First</p>}
          <div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Action distribution</p><ul className="mt-2 grid gap-1 text-sm">{actions.map((action) => <li key={action} className="flex justify-between gap-4"><span>{action.replaceAll("_", " ")}</span><span className="font-mono">{metric.actionDistribution[action]?.toLocaleString("en-IN") ?? 0}</span></li>)}</ul></div>
        </article>; })}
      </div>
    </section>
    <section aria-labelledby="contact-title" className="rounded-2xl border border-[var(--line)] bg-white p-6"><h2 id="contact-title" className="text-xl font-semibold">Synthetic customer intervention comparison</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">Context-aware decisions selected fewer customer interventions than the heuristic and Nudge First strategies in this controlled environment.</p><dl className="mt-5 grid gap-4 sm:grid-cols-3">{[["RecoveryIQ", recoveryIQ?.totalCustomerInterventions], ["Heuristic + Policy", evaluation.strategies.HEURISTIC_POLICY?.totalCustomerInterventions], ["Nudge First", evaluation.strategies.NAIVE_NUDGE_FIRST?.totalCustomerInterventions]].map(([label, value]) => <div key={String(label)}><dt className="text-sm text-[var(--muted)]">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{Number(value ?? 0).toLocaleString("en-IN")}</dd></div>)}</dl></section>
    <section aria-labelledby="policy-safety-title" className="rounded-2xl border-2 border-[var(--accent)] bg-white p-6"><p className="text-sm font-semibold text-[var(--accent)]">Stage 9 synthetic evaluation</p><h2 id="policy-safety-title" className="mt-2 text-2xl font-semibold">Policy safety analysis</h2><dl className="mt-6 grid gap-5 sm:grid-cols-3"><div><dt className="text-sm text-[var(--muted)]">Hard-rule decisions</dt><dd className="mt-1 text-3xl font-semibold">{percent(evaluation.policySafety.hardRuleDecisionRate)}</dd></div><div><dt className="text-sm text-[var(--muted)]">Model-ranked decisions</dt><dd className="mt-1 text-3xl font-semibold">{percent(evaluation.policySafety.modelRankedDecisionRate)}</dd></div><div><dt className="text-sm text-[var(--muted)]">Raw ML winner blocked</dt><dd className="mt-1 text-3xl font-semibold">{percent(evaluation.policySafety.rawModelWinnerBlockedRate)}</dd></div></dl><p className="mt-5 max-w-3xl text-sm leading-6 text-[var(--muted)]">In nearly 30% of simulated cases, deterministic policy prevented the model&apos;s highest-scoring action from being used. ML predicts. Policy controls.</p></section>
    {recoveryIQ && <section aria-labelledby="action-distribution-title"><h2 id="action-distribution-title" className="text-xl font-semibold">RecoveryIQ action distribution</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{actions.map((action) => <article key={action} className="rounded-xl border border-[var(--line)] bg-white p-5"><p className="break-words text-xs font-semibold text-[var(--muted)]">{action}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{recoveryIQ.actionDistribution[action]?.toLocaleString("en-IN") ?? 0}</p></article>)}</div></section>}
    {recoveryIQ && <section aria-labelledby="category-title" className="rounded-2xl border border-[var(--line)] bg-white p-6"><h2 id="category-title" className="text-xl font-semibold">Behavior by failure category</h2><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-[var(--muted)]"><tr><th className="pb-3 font-medium">Failure category</th><th className="pb-3 font-medium">Cases</th><th className="pb-3 font-medium">Expected rate</th><th className="pb-3 font-medium">Realized rate</th><th className="pb-3 font-medium">Typical selection</th></tr></thead><tbody>{Object.entries(recoveryIQ.perCategory).map(([category, value]) => <tr key={category} className="border-t border-[var(--line)]"><td className="py-3 font-semibold">{category}</td><td className="py-3 tabular-nums">{value.caseCount.toLocaleString("en-IN")}</td><td className="py-3 tabular-nums">{percent(value.expectedRecoveryRate)}</td><td className="py-3 tabular-nums">{percent(value.realizedRecoveryRate)}</td><td className="py-3 font-medium">{value.dominantSelectedAction}</td></tr>)}</tbody></table></div></section>}
    <p className="break-all text-xs text-[var(--muted)]">Dataset SHA-256: {evaluation.datasetHash}</p>
  </div>;
}
