import { AppHeader } from "@/components/AppHeader";
import { SubscriptionsList } from "@/components/SubscriptionsList";

export default function SubscriptionsPage() {
  return <main className="min-h-[100dvh] px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl">
    <AppHeader />
    <section className="py-12"><p className="text-sm font-semibold text-[var(--accent)]">Local subscription registry</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">CloudDesk subscriptions.</h1><p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">Manually synchronize state with Razorpay until webhook processing is introduced in Stage 3.</p></section>
    <SubscriptionsList />
  </div></main>;
}
