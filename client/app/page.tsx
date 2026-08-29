import { SystemStatus } from "@/components/SystemStatus";
import { AppHeader } from "@/components/AppHeader";
import { RecoveryMetricsSummary } from "@/components/RecoveryMetricsSummary";
import Link from "next/link";
const metrics = ["Revenue At Risk", "Recovered Revenue", "Open Recovery Cases"];
export default function Home() {
  const pipeline = ["Detect", "Diagnose", "Predict", "Decide", "Execute", "Measure"];
  return <main className="min-h-[100dvh] px-5 py-8 sm:px-8 lg:px-12">
    <div className="mx-auto max-w-6xl">
      <AppHeader />
      <section className="py-14 md:py-20">
        <p className="mb-4 text-sm font-semibold text-[var(--accent)]">Revenue operations infrastructure</p>
        <h1 className="max-w-3xl text-5xl font-semibold leading-none tracking-[-0.05em] sm:text-7xl">RecoveryIQ</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">Context-aware revenue recovery for failed recurring payments.</p>
        <ol aria-label="RecoveryIQ pipeline" className="mt-9 flex max-w-4xl flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)]">{pipeline.map((step, index) => <li key={step} className="flex items-center gap-2"><span className="rounded-lg border border-[var(--line)] bg-white px-3 py-2">{step}</span>{index < pipeline.length - 1 && <span aria-hidden="true">→</span>}</li>)}</ol>
      </section>
      <section aria-labelledby="live-observations"><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Production data</p><h2 id="live-observations" className="mt-2 text-2xl font-semibold">Live Razorpay Observations</h2></div><Link href="/evaluation" className="text-sm font-semibold text-[var(--accent)] hover:underline">View separate synthetic evaluation →</Link></div><RecoveryMetricsSummary /></section>
      <section aria-hidden="true" className="hidden">
        {metrics.map((label) => <article key={label} className="border-b border-[var(--line)] py-7 last:border-0 sm:border-b-0 sm:px-6 sm:first:pl-0"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight">₹0</p></article>)}
      </section>
      <div className="py-10"><SystemStatus /></div>
    </div>
  </main>;
}
