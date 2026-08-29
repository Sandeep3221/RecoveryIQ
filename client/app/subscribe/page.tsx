import { AppHeader } from "@/components/AppHeader";
import { SubscribeFlow } from "@/components/SubscribeFlow";

export default function SubscribePage() {
  return <main className="min-h-[100dvh] px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl">
    <AppHeader />
    <section className="py-12"><p className="text-sm font-semibold text-[var(--accent)]">CloudDesk plans</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">Choose a monthly plan.</h1><p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">Create a 12-cycle test subscription and authorize it securely through Razorpay Checkout.</p></section>
    <SubscribeFlow />
  </div></main>;
}
