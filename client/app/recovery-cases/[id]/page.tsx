import { AppHeader } from "@/components/AppHeader";
import { RecoveryCaseDetailView } from "@/components/RecoveryCaseDetailView";

export default async function RecoveryCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="min-h-[100dvh] px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl"><AppHeader /><section className="py-12"><p className="text-sm font-semibold text-[var(--accent)]">Deterministic recovery policy</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">Recovery case detail.</h1><p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">Evidence, recovery probabilities, and policy decisions remain separate from action execution.</p></section><RecoveryCaseDetailView caseId={id} /></div></main>;
}
