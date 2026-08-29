import { CardUpdateFlow } from "@/components/CardUpdateFlow";

export default async function CardRecoveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="min-h-[100dvh] px-5 py-12 sm:px-8"><div className="mx-auto max-w-2xl"><div className="mb-10 text-lg font-semibold">CloudDesk</div><CardUpdateFlow token={token} /></div></main>;
}
