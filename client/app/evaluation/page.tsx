import { AppHeader } from "@/components/AppHeader";
import { PolicyEvaluationView } from "@/components/PolicyEvaluationView";

export default function EvaluationPage() {
  return <main className="min-h-[100dvh] px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl">
    <AppHeader />
    <section className="py-12"><p className="text-sm font-semibold text-[var(--accent)]">Controlled offline analysis</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">Synthetic Policy Evaluation</h1><p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">RecoveryIQ’s frozen production scorer and deterministic policy are compared with naive strategies under the same unseen synthetic contexts and shared random outcomes.</p><p className="mt-4 max-w-3xl font-semibold text-amber-900">These results are simulation-only and do not represent real merchant uplift.</p></section>
    <PolicyEvaluationView />
  </div></main>;
}
