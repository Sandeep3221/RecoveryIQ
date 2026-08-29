"use client";
import { useEffect, useState } from "react";

type ApiState = "checking" | "online" | "offline";
export function SystemStatus() {
  const [backend, setBackend] = useState<ApiState>("checking");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/health/ready`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Backend is not ready"); return response.json(); })
      .then(() => setBackend("online")).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setBackend("offline"); });
    return () => controller.abort();
  }, []);
  return <section className="border-t border-[var(--line)] pt-7" aria-labelledby="system-status">
    <h2 id="system-status" className="text-sm font-semibold">System Status</h2>
    <dl className="mt-4 grid max-w-xl gap-3 text-sm sm:grid-cols-2">
      <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white px-4 py-3"><dt className="text-[var(--muted)]">Frontend</dt><dd className="font-medium text-[var(--accent)]">Online</dd></div>
      <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white px-4 py-3"><dt className="text-[var(--muted)]">Backend</dt><dd className={backend === "online" ? "font-medium text-[var(--accent)]" : "font-medium text-[var(--muted)]"}>{backend === "checking" ? "Checking" : backend === "online" ? "Ready" : "Unavailable"}</dd></div>
    </dl>
  </section>;
}

