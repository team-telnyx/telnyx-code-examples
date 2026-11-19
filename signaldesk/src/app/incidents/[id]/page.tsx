import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { updateIncidentStatus } from "@/app/actions/status";
import { Card, EmptyState, MaskedPhone, SeverityBadge, StatusBadge } from "@/components/ui";
import { getIncidentById, listIncidentUpdates } from "@/lib/incidents";
import {
  getIncidentSourceMessage,
  listOutboundDeliveryState,
  getIncidentSubscriberCount,
} from "@/lib/queries";
import { allowedTransitions } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function IncidentDetailPage({
  params,
  searchParams,
}: PageProps<"/incidents/[id]">) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const query = await searchParams;

  const incident = await getIncidentById(id);
  if (!incident) notFound();

  const [updates, subscriberCount, deliveries, sourceMessage] = await Promise.all([
    listIncidentUpdates(incident.id),
    getIncidentSubscriberCount(incident.id),
    listOutboundDeliveryState(incident.id),
    getIncidentSourceMessage(incident.id),
  ]);

  const error = typeof query.error === "string" ? query.error : null;
  const updated = query.updated === "1";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Dashboard
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold text-teal-400">{incident.number}</span>
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{incident.title}</h1>
          <p className="max-w-2xl text-sm text-zinc-400">{incident.summary}</p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <p>
            Reporter <MaskedPhone phone={incident.reporterPhone} />
          </p>
          <p className="mt-1">Confidence {(incident.confidence * 100).toFixed(0)}%</p>
          <p className="mt-1">{subscriberCount} subscriber{subscriberCount === 1 ? "" : "s"}</p>
        </div>
      </header>

      {updated && (
        <p role="status" className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Status updated and subscribers notified.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error === "invalid_transition"
            ? "That status transition is not allowed."
            : "Something went wrong. Try again."}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="AI-extracted report">
          <dl className="space-y-3 text-sm">
            <Field label="Affected service" value={incident.affectedService} />
            <Field label="Affected region" value={incident.affectedRegion ?? "—"} />
            <Field label="Symptoms" value={incident.symptoms} />
            <Field label="Suggested next action" value={incident.suggestedNextAction} />
          </dl>
        </Card>

        <Card title="Original report">
          <blockquote className="rounded border border-zinc-800 bg-zinc-950/60 p-3 text-sm italic text-zinc-300">
            “{sourceMessage?.body ?? "Original message not retained"}”
          </blockquote>
          <p className="mt-3 text-xs text-zinc-500">
            Source message ID <span className="font-mono">{incident.sourceMessageId}</span>
          </p>
        </Card>

        <Card title="Update status">
          <form action={updateIncidentStatus} className="space-y-3">
            <input type="hidden" name="incidentId" value={incident.id} />
            <div>
              <label
                htmlFor="newStatus"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400"
              >
                New status
              </label>
              <select
                id="newStatus"
                name="newStatus"
                required
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
              >
                {allowedTransitions(incident.status).map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="operatorNote"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400"
              >
                Operator note (optional)
              </label>
              <textarea
                id="operatorNote"
                name="operatorNote"
                rows={3}
                maxLength={500}
                placeholder="What changed? Included in the subscriber SMS."
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
            <button
              type="submit"
              className="rounded bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
            >
              Update & notify subscribers
            </button>
          </form>
        </Card>

        <Card title="Outbound delivery">
          {deliveries.length === 0 ? (
            <EmptyState title="No outbound messages yet" />
          ) : (
            <ul className="space-y-2 text-sm">
              {deliveries.map((delivery, index) => (
                <li
                  key={`${delivery.telnyxMessageId ?? index}`}
                  className="flex items-center justify-between gap-2 rounded border border-zinc-800 px-3 py-2"
                >
                  <span className="font-mono text-xs text-zinc-400">{delivery.eventType}</span>
                  <span
                    className={
                      delivery.deliveryStatus === "failed"
                        ? "text-xs font-semibold text-red-400"
                        : delivery.deliveryStatus === "delivered"
                          ? "text-xs font-semibold text-emerald-400"
                          : delivery.deliveryStatus === "mock_outbox"
                            ? "text-xs font-semibold text-amber-400"
                            : "text-xs font-semibold text-zinc-300"
                    }
                  >
                    {delivery.deliveryStatus ?? "pending"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            Acceptance is not delivery — final states arrive via Telnyx webhooks.
          </p>
        </Card>

        <Card title="Status timeline">
          <ol className="space-y-3 border-l border-zinc-800 pl-4">
            {updates.map((update) => (
              <li key={update.id} className="relative">
                <span className="absolute -left-[21px] mt-1.5 h-2.5 w-2.5 rounded-full border border-teal-500 bg-zinc-950" />
                <p className="text-sm text-zinc-200">
                  {update.previousStatus ? (
                    <>
                      {update.previousStatus} → <strong>{update.newStatus}</strong>
                    </>
                  ) : (
                    <strong>{update.newStatus}</strong>
                  )}
                </p>
                {update.operatorNote && (
                  <p className="text-xs text-zinc-400">{update.operatorNote}</p>
                )}
                <p className="text-xs text-zinc-600">
                  {new Date(update.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-zinc-200">{value || "—"}</dd>
    </div>
  );
}
