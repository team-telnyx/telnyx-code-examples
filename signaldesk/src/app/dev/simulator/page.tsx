import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isDev } from "@/lib/config";
import { Card } from "@/components/ui";
import { SimulatorForm } from "./simulator-form";

export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const dev = isDev();
  if (!dev) notFound();

  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Inbound SMS simulator</h1>
        <p className="text-sm text-zinc-400">
          Development only. Processes the message through the exact same pipeline as the
          Telnyx webhook, including classification, incident creation, and the mock
          outbox when <code className="text-xs">SIGNALDESK_MOCK_SMS=true</code>.
        </p>
      </header>

      <Card>
        <SimulatorForm />
      </Card>

      <Card title="Tips">
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-400">
          <li>Use <code className="text-zinc-300">ALLOWED_REPORTER_NUMBERS</code> from your .env so simulated reports aren’t rejected.</li>
          <li>
            Reply <code className="text-zinc-300">STOP</code> to test opt-out, then{" "}
            <code className="text-zinc-300">START</code> to restore.
          </li>
          <li>Check <Link href="/dev/outbox" className="underline underline-offset-2">the outbox</Link> for messages that would have been sent.</li>
        </ul>
      </Card>
    </div>
  );
}
