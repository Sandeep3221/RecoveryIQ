import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

export default function NotFound() {
  return <main className="min-h-[100dvh] px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl"><AppHeader /><section className="py-20"><p className="text-sm font-semibold text-[var(--accent)]">Page not found</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">This RecoveryIQ page does not exist.</h1><p className="mt-4 max-w-xl leading-7 text-[var(--muted)]">The requested route may be outdated or incomplete. No recovery state was changed.</p><Link href="/" className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white">Return to Dashboard</Link></section></div></main>;
}
