import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { isDev, isMockSms } from "@/lib/config";
import { Card, EmptyState, MaskedPhone } from "@/components/ui";
import { countOutbox } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function OutboxPage() {
  const dev = isDev();
  const mock = isMockSms();
  if (!dev && !mock) notFound();

  const session = await auth();
  if (!session?.user) redirect("/login");

  const messages = await countOutbox(50);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Development outbox</h1>
        <p className="text-sm text-zinc-400">
          Outbound SMS that SignalDesk {mock ? "would" : "tried"} to send via Telnyx.{" "}
          {mock
            ? "Mock mode is on — nothing left the machine."
            : "Mock mode is off — these were sent for real."}
        </p>
      </header>

      <Card>
        {messages.length === 0 ? (
          <EmptyState
            title="No outbound messages"
            hint="Simulate an inbound report or update an incident to see SMS here."
          />
        ) : (
          <ul className="divide-y divide-zinc-800">
            {messages.map((message) => (
              <li key={message.id} className="px-1 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono uppercase text-zinc-400">
                    {message.eventType}
                  </span>
                  <MaskedPhone phone={message.phone} />
                  <span
                    className={`font-mono text-[10px] uppercase ${
                      message.deliveryStatus === "failed"
                        ? "text-red-400"
                        : message.deliveryStatus === "mock_outbox"
                          ? "text-amber-400"
                          : "text-emerald-400"
                    }`}
                  >
                    {message.deliveryStatus}
                  </span>
                  <span className="ml-auto text-zinc-600">
                    {new Date(message.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{message.body}</p>
                {message.errorDetails && (
                  <p className="mt-1 text-xs text-red-400">{message.errorDetails}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
