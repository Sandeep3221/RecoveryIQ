"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { AuditEventView, FailureEvidenceView, RecoveryActionView, RecoveryCaseDetail, RecoveryContextView, RecoveryDecisionView, RecoveryOutcomeView, RecoveryScoreView } from "@/types";

interface DetailResponse { case: RecoveryCaseDetail; latestFailure: FailureEvidenceView | null; actionCount: number; auditEvents: AuditEventView[] }
interface DiagnoseResponse { case: RecoveryCaseDetail; classification: { category: string; confidence: string; explanation: string }; downtime: { checked: boolean; active: boolean; matched: boolean; matchLevel: string; explanation: string }; context: RecoveryContextView }
interface ScoreResponse { caseId: string; scorerVersion: string; datasetVersion: string | null; scores: RecoveryScoreView[] }
interface DecideResponse { caseId: string; status: "DECIDED"; decision: RecoveryDecisionView }
interface ExecuteResponse { caseId: string; caseStatus: string; action: RecoveryActionView; recoveryUrl?: string }

function money(value: number): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value / 100); }
function downtimeLabel(context: RecoveryContextView["downtime"] | undefined): string {
  if (!context?.checked) return "Downtime lookup unavailable";
  if (context.active && context.matchLevel === "EXACT") return "Confirmed relevant downtime";
  if (context.matchLevel === "METHOD_ONLY") return "Payment-method downtime observed, exact applicability unknown";
  if (context.matchLevel === "NONE") return "No relevant downtime detected";
  return "Downtime applicability unknown";
}

function CasePipeline({ recoveryCase }: { recoveryCase: RecoveryCaseDetail }) {
  const steps = [
    ["Failure Detected", true],
    ["Diagnosed", Boolean(recoveryCase.latestContext)],
    ["Scored", Boolean(recoveryCase.latestScores)],
    ["Policy Evaluated", Boolean(recoveryCase.latestDecision)],
    ["Action Executed", Boolean(recoveryCase.actions?.some((action) => action.status === "EXECUTED"))],
    [recoveryCase.outcome?.status === "RECOVERED" ? "Outcome Observed" : "Outcome Pending", recoveryCase.outcome?.status === "RECOVERED"],
  ] as const;
  return <section aria-labelledby="case-pipeline-title" className="overflow-hidden rounded-xl border border-[var(--line)] bg-white p-5"><h2 id="case-pipeline-title" className="text-sm font-semibold">Recovery pipeline</h2><ol className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{steps.map(([label, complete], index) => <li key={label} className="relative min-w-0"><div className="flex items-center gap-2"><span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${complete ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] text-[var(--muted)]"}`}>{complete ? "✓" : index + 1}</span><span className="text-xs font-semibold leading-5">{label}</span></div></li>)}</ol></section>;
}

function DecisionPanel({ decision, actionCount, status, executing, onExecute }: { decision: RecoveryDecisionView; actionCount: number; status: string; executing: boolean; onExecute: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return <section className="rounded-xl border-2 border-[var(--accent)] bg-white p-6" aria-labelledby="recovery-decision-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--accent)]">ML predicts. Policy controls.</p><h2 id="recovery-decision-title" className="mt-2 text-2xl font-semibold">Policy Decision</h2><p className="mt-3 break-words text-xl font-semibold">{decision.selectedAction}</p></div><span className="rounded-full border border-[var(--line)] px-3 py-1 text-sm font-medium">Hard Rule: {decision.hardRuleApplied ? "Yes" : "No"}</span></div>
    <p className="mt-4 leading-7 text-[var(--muted)]">{decision.explanation}</p>
    <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-[var(--muted)]">Reason</dt><dd className="mt-1 break-words font-semibold">{decision.reasonCode}</dd></div><div><dt className="text-[var(--muted)]">Policy version</dt><dd className="mt-1 font-semibold">{decision.policyVersion}</dd></div><div><dt className="text-[var(--muted)]">Scorer version</dt><dd className="mt-1 font-semibold">{decision.scorerVersion}</dd></div><div><dt className="text-[var(--muted)]">Predicted recovery probability</dt><dd className="mt-1 font-semibold tabular-nums">{(decision.selectedProbability * 100).toFixed(2)}%</dd></div><div><dt className="text-[var(--muted)]">Expected recovered amount</dt><dd className="mt-1 font-semibold">{money(decision.expectedRecoveredMinor)}</dd></div><div><dt className="text-[var(--muted)]">Action count</dt><dd className="mt-1 font-semibold tabular-nums">{actionCount}</dd></div></dl>
    <div className="mt-6 grid gap-5 lg:grid-cols-2"><div><h3 className="text-sm font-semibold">Allowed Actions</h3><ul className="mt-3 space-y-2">{decision.allowedActions.map((action) => <li key={action} className="rounded-lg bg-[var(--canvas)] px-3 py-2 text-sm font-medium">{action}</li>)}</ul></div><div><h3 className="text-sm font-semibold">Blocked Actions</h3><ul className="mt-3 space-y-2">{decision.blockedActions.map((item) => <li key={item.action} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm"><span className="block font-medium">{item.action} · {item.reasonCode}</span><span className="mt-1 block leading-5 text-[var(--muted)]">{item.explanation}</span></li>)}</ul></div></div>
    {actionCount === 0 ? <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Decision selected. No recovery action has been executed.</p> : <p className="mt-6 rounded-lg bg-[var(--canvas)] px-4 py-3 text-sm font-semibold">This decision has an associated recovery action.</p>}
    {status === "DECIDED" && <button type="button" onClick={() => setConfirming(true)} className="mt-5 min-h-11 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">Execute Selected Action</button>}
    {confirming && <div role="dialog" aria-modal="true" aria-labelledby="execute-confirm-title" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-5"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"><h3 id="execute-confirm-title" className="text-xl font-semibold">Execute {decision.selectedAction}?</h3><p className="mt-3 text-sm leading-6 text-[var(--muted)]">This executes only the action selected by policy. It does not make a new decision.</p><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={() => setConfirming(false)} disabled={executing} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold">Cancel</button><button type="button" disabled={executing} aria-busy={executing} onClick={() => { onExecute(); setConfirming(false); }} className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60">{executing ? "Executing…" : "Confirm Execution"}</button></div></div></div>}
  </section>;
}

function ActionPanel({ action, recoveryUrl }: { action: RecoveryActionView; recoveryUrl: string | null }) {
  const value = (key: string) => String(action.metadata[key] ?? "Not applicable");
  const title = action.type === "WAIT_NATIVE_RETRY" ? "Waiting for Razorpay Native Retry" : action.type === "SEND_NUDGE" ? "Recovery Nudge" : action.type === "REQUEST_CARD_UPDATE" ? "Card Update Requested" : "Stopped: Merchant Review Required";
  return <section className="rounded-xl border border-[var(--line)] bg-white p-6" aria-labelledby="execution-title"><p className="text-sm font-semibold text-[var(--accent)]">Bounded execution</p><h2 id="execution-title" className="mt-2 text-2xl font-semibold">{title}</h2><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-[var(--muted)]">Selected action</dt><dd className="mt-1 font-semibold">{action.type}</dd></div><div><dt className="text-[var(--muted)]">Execution status</dt><dd className="mt-1 font-semibold">{action.status}</dd></div><div><dt className="text-[var(--muted)]">Execution mode</dt><dd className="mt-1 font-semibold uppercase">{action.executionMode}</dd></div><div><dt className="text-[var(--muted)]">Executed at</dt><dd className="mt-1 font-semibold">{action.executedAt ? new Date(action.executedAt).toLocaleString() : "Pending"}</dd></div></dl>
    {action.type === "WAIT_NATIVE_RETRY" && <p className="mt-5 rounded-lg bg-[var(--canvas)] px-4 py-3 text-sm leading-6">RecoveryIQ has not scheduled or initiated a payment attempt. Razorpay owns the native retry process.</p>}
    {action.type === "SEND_NUDGE" && <div className="mt-5 space-y-2 text-sm"><p><span className="text-[var(--muted)]">Delivery status:</span> {value("deliveryStatus")}</p><p><span className="text-[var(--muted)]">Template version:</span> {value("templateVersion")}</p><p><span className="text-[var(--muted)]">customerContacted:</span> {value("customerContacted")}</p>{action.metadata.deliveryMode === "simulation" && <p className="rounded-lg bg-amber-50 px-4 py-3 font-semibold text-amber-900">Simulated delivery: no customer was contacted.</p>}</div>}
    {action.type === "REQUEST_CARD_UPDATE" && <div className="mt-5 text-sm"><p><span className="text-[var(--muted)]">Session expiry:</span> {action.metadata.expiresAt ? new Date(String(action.metadata.expiresAt)).toLocaleString() : "Unavailable"}</p>{recoveryUrl && <a href={recoveryUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-[var(--accent)] px-4 font-semibold text-[var(--accent)]">Open Card Update Session</a>}</div>}
    {action.status === "FAILED" && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{action.failureReason ?? "Execution failed safely."}</p>}
  </section>;
}

function OutcomePanel({ outcome }: { outcome: RecoveryOutcomeView }) {
  return <section className="rounded-xl border border-[var(--accent)] bg-white p-6" aria-labelledby="outcome-title"><p className="text-sm font-semibold text-[var(--accent)]">Authoritative Payment Evidence</p><h2 id="outcome-title" className="mt-2 text-2xl font-semibold">Recovery Outcome</h2><dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-[var(--muted)]">Outcome</dt><dd className="mt-1 font-semibold">{outcome.status}</dd></div><div><dt className="text-[var(--muted)]">Recovered Amount</dt><dd className="mt-1 font-semibold">{money(outcome.recoveredAmountMinor)}</dd></div><div><dt className="text-[var(--muted)]">Recovered At</dt><dd className="mt-1 font-semibold">{outcome.recoveredAt ? new Date(outcome.recoveredAt).toLocaleString() : "Unavailable"}</dd></div><div><dt className="text-[var(--muted)]">Time to Recovery</dt><dd className="mt-1 font-semibold">{outcome.timeToRecoveryHours === null ? "Unavailable" : `${outcome.timeToRecoveryHours.toFixed(2)} hours`}</dd></div><div><dt className="text-[var(--muted)]">Within 7 Days</dt><dd className="mt-1 font-semibold">{outcome.recoveredWithin7Days === null ? "Unknown" : outcome.recoveredWithin7Days ? "Yes" : "No"}</dd></div><div><dt className="text-[var(--muted)]">Payment ID</dt><dd className="mt-1 break-all font-mono text-xs">{outcome.razorpayPaymentId ?? "Unavailable"}</dd></div><div><dt className="text-[var(--muted)]">Invoice ID</dt><dd className="mt-1 break-all font-mono text-xs">{outcome.razorpayInvoiceId ?? "Unavailable"}</dd></div><div><dt className="text-[var(--muted)]">Case Match</dt><dd className="mt-1 font-semibold">{outcome.matchLevel} · {outcome.caseMatchConfidence}</dd></div><div><dt className="text-[var(--muted)]">Associated Action</dt><dd className="mt-1 font-semibold">{outcome.actionAtRecovery ?? "None"}</dd></div><div><dt className="text-[var(--muted)]">Association Confidence</dt><dd className="mt-1 font-semibold">{outcome.actionAssociationConfidence}</dd></div></dl><p className="mt-6 max-w-3xl leading-7 text-[var(--muted)]">{outcome.explanation}</p><p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium leading-6 text-amber-900">Recovery association describes event sequence and correlation. It does not by itself establish causal uplift.</p></section>;
}

export function RecoveryCaseDetailView({ caseId }: { caseId: string }) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function load(): Promise<void> {
    const result = await apiRequest<DetailResponse>(`/api/v1/recovery-cases/${caseId}`);
    setData(result);
  }
  useEffect(() => {
    let active = true;
    apiRequest<DetailResponse>(`/api/v1/recovery-cases/${caseId}`).then((result) => { if (active) setData(result); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Recovery case could not be loaded."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId]);
  async function diagnose(): Promise<void> {
    setDiagnosing(true); setError(null);
    try {
      const result = await apiRequest<DiagnoseResponse>(`/api/v1/recovery-cases/${caseId}/diagnose`, { method: "POST" });
      await load();
      setData((current) => current ? { ...current, case: { ...current.case, ...result.case, latestContext: result.context } } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Diagnosis could not be completed."); }
    finally { setDiagnosing(false); }
  }
  async function score(): Promise<void> {
    setScoring(true); setError(null);
    try {
      await apiRequest<ScoreResponse>(`/api/v1/recovery-cases/${caseId}/score`, { method: "POST" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Recovery possibilities could not be scored."); }
    finally { setScoring(false); }
  }
  async function decide(): Promise<void> {
    setDeciding(true); setError(null);
    try {
      await apiRequest<DecideResponse>(`/api/v1/recovery-cases/${caseId}/decide`, { method: "POST" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Recovery policy could not be evaluated."); }
    finally { setDeciding(false); }
  }
  async function execute(): Promise<void> {
    setExecuting(true); setError(null);
    try { const result = await apiRequest<ExecuteResponse>(`/api/v1/recovery-cases/${caseId}/execute`, { method: "POST" }); setRecoveryUrl(result.recoveryUrl ?? null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Selected action could not be executed."); }
    finally { setExecuting(false); }
  }
  if (loading) return <div className="h-72 animate-pulse rounded-xl bg-white" aria-label="Loading recovery case" />;
  if (error && !data) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>;
  if (!data) return null;
  const context = data.case.latestContext;
  const failure = data.latestFailure;
  const classification = failure?.classification;
  const raw = failure?.razorpayError;
  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-[var(--line)] bg-white p-5"><p className="text-sm text-[var(--muted)]">Plan</p><p className="mt-2 text-xl font-semibold">{data.case.subscriptionId?.plan.name ?? "Unavailable"}</p><p className="mt-2 text-2xl font-semibold">{money(data.case.revenueAtRiskMinor)}</p></div>
      <div className="rounded-xl border border-[var(--line)] bg-white p-5"><p className="text-sm text-[var(--muted)]">Subscription Status</p><p className="mt-2 text-lg font-semibold uppercase">{data.case.subscriptionId?.status ?? "Unknown"}</p></div>
      <div className="rounded-xl border border-[var(--line)] bg-white p-5"><p className="text-sm text-[var(--muted)]">Recovery Case State</p><p className="mt-2 text-lg font-semibold uppercase">{data.case.status}</p></div>
      <div className="rounded-xl border border-[var(--line)] bg-white p-5"><p className="text-sm text-[var(--muted)]">Selected Action</p><p className="mt-2 break-words text-lg font-semibold">{data.case.latestDecision?.selectedAction ?? "Not selected"}</p><p className="mt-2 text-xs text-[var(--muted)]">{data.case.latestDecision ? `${data.case.latestDecision.scorerVersion} · ${data.case.latestDecision.policyVersion}` : "Awaiting policy evaluation"}</p></div>
    </section>
    <CasePipeline recoveryCase={data.case} />
    {data.case.status === "DETECTED" && <button onClick={() => void diagnose()} disabled={diagnosing} className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 active:translate-y-px">{diagnosing ? "Diagnosing" : "Diagnose"}</button>}
    {data.case.status === "DIAGNOSED" && !data.case.latestScores && <button type="button" onClick={() => void score()} disabled={scoring} aria-busy={scoring} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60">{scoring ? "Scoring Recovery Options…" : "Score Recovery Options"}</button>}
    {data.case.status === "DIAGNOSED" && data.case.latestScores && <button type="button" onClick={() => void decide()} disabled={deciding} aria-busy={deciding} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60">{deciding ? "Evaluating Recovery Policy…" : "Evaluate Recovery Policy"}</button>}
    {data.case.latestDecision && <DecisionPanel decision={data.case.latestDecision} actionCount={data.actionCount} status={data.case.status} executing={executing} onExecute={() => void execute()} />}
    {data.case.actions?.[0] && <ActionPanel action={data.case.actions[0]} recoveryUrl={recoveryUrl} />}
    {data.case.outcome?.status === "RECOVERED" && <OutcomePanel outcome={data.case.outcome} />}
    {data.case.outcome?.status !== "RECOVERED" && <section className="rounded-xl border border-[var(--line)] bg-white p-6" aria-labelledby="outcome-pending-title"><p className="text-sm font-semibold text-[var(--accent)]">Authoritative outcome tracking</p><h2 id="outcome-pending-title" className="mt-2 text-2xl font-semibold">Outcome Pending</h2><p className="mt-4 text-2xl font-semibold">{money(Math.max(data.case.revenueAtRiskMinor - (data.case.outcome?.recoveredAmountMinor ?? 0), 0))} still at risk</p><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">RecoveryIQ is waiting for authoritative successful-payment evidence from Razorpay. An executed action is not counted as recovered revenue.</p></section>}
    {data.case.latestScores && <section className="rounded-xl border border-[var(--line)] bg-white p-6" aria-labelledby="recovery-possibilities-title"><div className="flex flex-wrap items-start justify-between gap-3"><h2 id="recovery-possibilities-title" className="text-lg font-semibold">Recovery Predictions</h2><div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]"><span className="rounded-full border border-[var(--line)] px-2.5 py-1">Scorer: {data.case.latestScores.scorerVersion}</span>{data.case.latestScores.datasetVersion && <span className="rounded-full border border-[var(--line)] px-2.5 py-1">Dataset: {data.case.latestScores.datasetVersion}</span>}</div></div><p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">Probabilities are experimental estimates from logistic-v1 trained on synthetic recovery episodes. Policy, not score rank, owns the decision.</p><div className="mt-5 grid gap-4 md:grid-cols-2">{data.case.latestScores.scores.map((scoreItem) => <article key={scoreItem.action} className="rounded-xl border border-[var(--line)] bg-[var(--canvas)] p-5"><div className="flex items-start justify-between gap-4"><h3 className="break-words text-sm font-semibold tracking-wide">{scoreItem.action}</h3><span className="text-2xl font-semibold tabular-nums">{(scoreItem.probability * 100).toFixed(2)}%</span></div><dl className="mt-3 text-sm"><dt className="text-[var(--muted)]">Expected recovered amount</dt><dd className="mt-1 font-semibold">{money(scoreItem.expectedRecoveredMinor)}</dd><dt className="mt-3 text-[var(--muted)]">Scorer</dt><dd className="mt-1 font-semibold">{scoreItem.scorerVersion}</dd></dl><details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold text-[var(--accent)]">Technical explanation</summary><p className="mt-3 leading-6 text-[var(--muted)]">{scoreItem.explanation}</p></details></article>)}</div></section>}
    <section className="rounded-xl border border-[var(--line)] bg-white p-6"><p className="text-sm font-semibold text-[var(--accent)]">Deterministic classification</p><h2 className="mt-2 text-2xl font-semibold">Failure Diagnosis</h2><p className="mt-4 break-words text-2xl font-semibold">{context?.failure.category ?? failure?.normalizedCategory ?? "Not diagnosed"}</p><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-[var(--muted)]">Confidence</dt><dd className="mt-1 font-semibold">{context?.diagnosis.confidence ?? classification?.confidence ?? "Unavailable"}</dd></div><div><dt className="text-[var(--muted)]">Payment method</dt><dd className="mt-1 font-semibold">{context?.failure.paymentMethod ?? failure?.paymentMethod ?? "Unavailable"}</dd></div><div><dt className="text-[var(--muted)]">Error reason</dt><dd className="mt-1 break-words font-semibold">{context?.failure.reason ?? raw?.reason ?? "Not provided"}</dd></div><div><dt className="text-[var(--muted)]">Downtime</dt><dd className="mt-1 font-semibold">{downtimeLabel(context?.downtime)}</dd></div><div><dt className="text-[var(--muted)]">Native retry available</dt><dd className="mt-1 font-semibold">{context ? context.subscription.nativeRetryPossible ? "Yes" : "No" : "Unknown"}</dd></div><div><dt className="text-[var(--muted)]">Classifier</dt><dd className="mt-1 font-semibold">{context?.diagnosis.classifierVersion ?? classification?.version ?? "Unavailable"}</dd></div></dl><p className="mt-5 max-w-3xl leading-7 text-[var(--muted)]">{context?.diagnosis.explanation ?? classification?.explanation ?? "Diagnosis has not been run."}</p></section>
    <details className="rounded-xl border border-[var(--line)] bg-white p-6"><summary className="cursor-pointer text-lg font-semibold">Technical Razorpay Evidence</summary><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">{[["error_code", raw?.code], ["error_reason", raw?.reason], ["error_source", raw?.source], ["error_step", raw?.step], ["paymentMethod", failure?.paymentMethod]].map(([label, value]) => <div key={label}><dt className="font-mono text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words font-medium">{value ?? "Not provided"}</dd></div>)}</dl></details>
    <section className="rounded-xl border border-[var(--line)] bg-white p-6"><h2 className="text-lg font-semibold">Downtime Context</h2><p className="mt-4 font-semibold">{downtimeLabel(context?.downtime)}</p><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-[var(--muted)]">Match Level</dt><dd className="mt-1 font-medium">{context?.downtime.matchLevel ?? "UNKNOWN"}</dd></div><div><dt className="text-[var(--muted)]">Method</dt><dd className="mt-1 font-medium">{context?.downtime.method ?? "Unknown"}</dd></div><div><dt className="text-[var(--muted)]">Severity</dt><dd className="mt-1 font-medium">{context?.downtime.severity ?? "Unavailable"}</dd></div></dl>{failure?.downtimeSnapshot?.explanation && <p className="mt-5 leading-7 text-[var(--muted)]">{failure.downtimeSnapshot.explanation}</p>}</section>
    <section className="grid gap-6 lg:grid-cols-2"><div className="rounded-xl border border-[var(--line)] bg-white p-6"><h2 className="text-lg font-semibold">Customer History</h2>{context ? <dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-[var(--muted)]">Successful payments</dt><dd className="mt-1 font-semibold">{context.customerHistory.previousSuccessfulPayments}</dd></div><div><dt className="text-[var(--muted)]">Failed payments</dt><dd className="mt-1 font-semibold">{context.customerHistory.previousFailedPayments}</dd></div><div><dt className="text-[var(--muted)]">Recovered payments</dt><dd className="mt-1 font-semibold">{context.customerHistory.previousRecoveredPayments}</dd></div><div><dt className="text-[var(--muted)]">Recovery rate</dt><dd className="mt-1 font-semibold">{Math.round(context.customerHistory.previousRecoveryRate * 100)}%</dd></div></dl> : <p className="mt-4 text-sm text-[var(--muted)]">Available after diagnosis.</p>}</div><div className="rounded-xl border border-[var(--line)] bg-white p-6"><h2 className="text-lg font-semibold">Native Retry Available</h2><p className="mt-4 text-2xl font-semibold">{context ? context.subscription.nativeRetryPossible ? "Yes" : "No" : "Unknown"}</p><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Derived only from Razorpay subscription status. RecoveryIQ does not schedule retries.</p></div></section>
    <section className="rounded-xl border border-[var(--line)] bg-white p-6"><h2 className="text-lg font-semibold">Audit Timeline</h2><ol className="mt-5 space-y-4">{data.auditEvents.map((event) => <li key={event._id} className="grid gap-1 border-l-2 border-[var(--line)] pl-4 text-sm"><span className="font-medium">{event.title}</span><span className="text-[var(--muted)]">{event.eventType} · {new Date(event.occurredAt).toLocaleString()}</span></li>)}</ol></section>
  </div>;
}
