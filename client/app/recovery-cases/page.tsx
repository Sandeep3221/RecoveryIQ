import { AppHeader } from "@/components/AppHeader";
import { RecoveryCasesList } from "@/components/RecoveryCasesList";

export default function RecoveryCasesPage() {
  return <main className="min-h-[100dvh] px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl">
    <AppHeader />
    <section className="py-12"><p className="text-sm font-semibold text-[var(--accent)]">Observed failure cases</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">Recovery cases.</h1><p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">Webhook-derived cases only. No recovery decisions or actions are available in Stage 3.</p></section>
    <RecoveryCasesList />
  </div></main>;
}
