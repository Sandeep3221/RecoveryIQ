import Link from "next/link";

export function AppHeader() {
  return <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-center sm:justify-between">
    <Link href="/" className="min-h-11 self-start py-2 text-lg font-semibold tracking-tight">RecoveryIQ</Link>
    <nav aria-label="Primary" className="flex max-w-full items-center gap-1 overflow-x-auto pb-1 text-sm font-medium text-[var(--muted)] sm:pb-0">
      {[["Dashboard", "/"], ["Subscriptions", "/subscriptions"], ["Recovery Cases", "/recovery-cases"], ["Synthetic Evaluation", "/evaluation"]].map(([label, href]) => <Link key={href} className="min-h-11 shrink-0 rounded-lg px-3 py-3 hover:bg-white hover:text-[var(--ink)]" href={href}>{label}</Link>)}
    </nav>
  </header>;
}
