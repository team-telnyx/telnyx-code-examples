import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  Card,
  EmptyState,
  MaskedPhone,
  SeverityBadge,
  StatusBadge,
} from "@/components/ui";
import { isSeverity, SEVERITIES, type Severity } from "@/lib/severity";
import { isStatus, STATUSES, type Status } from "@/lib/status";
import {
  countDeliveryFailures,
  getIncidentCounts,
  listActiveIncidents,
  listIncidents,
  listOutboundFailures,
  listRecentInboundMessages,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: PageProps<"/">) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const statusParam = typeof params.status === "string" ? params.status.toUpperCase() : "";
  const severityParam = typeof params.severity === "string" ? params.severity.toUpperCase() : "";
  const filters = {
    status: isStatus(statusParam) ? (statusParam as Status) : undefined,
    severity: isSeverity(severityParam) ? (severityParam as Severity) : undefined,
  };

  const [
    counts,
    recent,
    active,
    inbound,
    failureCount,
    failures,
  ] = await Promise.all([
    getIncidentCounts(),
    listIncidents(filters, 20),
    listActiveIncidents(8),
    listRecentInboundMessages(8),
    countDeliveryFailures(),
    listOutboundFailures(5),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Operations dashboard</h1>
        <p className="text-sm text-zinc-400">
            SMS incident reports, triaged by AI, with subscriber updates over Telnyx messaging.
        </p>
      </header>

      {failureCount > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <span className="font-semibold">{failureCount}</span> outbound message
          {failureCount === 1 ? "" : "s"} failed to deliver.{" "}
          <a href="#failures" className="underline underline-offset-2">
            View failures
          </a>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SEVERITIES.map((sev) => (
          <div
            key={sev}
            className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <SeverityBadge severity={sev} />
              <span className="font-mono text-2xl font-semibold">{counts.bySeverity[sev]}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">total reports</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((status) => (
          <span
            key={status}
            className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300"
          >
            <span className="text-zinc-500">{status}:</span>{" "}
            <span className="font-mono font-semibold text-zinc-100">{counts.byStatus[status]}</span>
          </span>
        ))}
        <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300">
          <span className="text-zinc-500">all:</span>{" "}
          <span className="font-mono font-semibold text-zinc-100">{counts.total}</span>
        </span>
      </div>

      <Card
        title="Active incidents"
        actions={
          <span className="text-xs text-zinc-500">
            {active.length > 0 ? `${active.length} open` : ""}
          </span>
        }
      >
        {active.length === 0 ? (
          <EmptyState
            title="No active incidents"
            hint="Text a report to the SignalDesk number to open one."
          />
        ) : (
          <ul className="divide-y divide-zinc-800">
            {active.map((incident) => (
              <li key={incident.id}>
                <Link
                  href={`/incidents/${incident.id}`}
                  className="flex flex-col gap-1 px-1 py-3 hover:bg-zinc-900/60 sm:flex-row sm:items-center sm:gap-3"
                >
                  <SeverityBadge severity={incident.severity} />
                  <StatusBadge status={incident.status} />
                  <span className="font-mono text-xs text-teal-400">{incident.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {incident.title}
                  </span>
                  <MaskedPhone phone={incident.reporterPhone} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="All incidents">
        <form className="mb-3 flex flex-wrap items-center gap-2" method="get">
          <label htmlFor="status" className="text-xs text-zinc-400">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={statusParam}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label htmlFor="severity" className="ml-2 text-xs text-zinc-400">
            Severity
          </label>
          <select
            id="severity"
            name="severity"
            defaultValue={severityParam}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="ml-2 rounded bg-zinc-700 px-3 py-1 text-sm text-zinc-100 hover:bg-zinc-600"
          >
            Filter
          </button>
          {(statusParam || severityParam) && (
            <Link href="/" className="ml-1 text-xs text-zinc-400 hover:text-zinc-200">
              Clear
            </Link>
          )}
        </form>

        {recent.length === 0 ? (
          <EmptyState title="No incidents match these filters" />
        ) : (
          <ul className="divide-y divide-zinc-800">
            {recent.map((incident) => (
              <li key={incident.id}>
                <Link
                  href={`/incidents/${incident.id}`}
                  className="flex flex-col gap-1 px-1 py-3 hover:bg-zinc-900/60 sm:flex-row sm:items-center sm:gap-3"
                >
                  <SeverityBadge severity={incident.severity} />
                  <StatusBadge status={incident.status} />
                  <span className="font-mono text-xs text-teal-400">{incident.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {incident.title}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {new Date(incident.createdAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent inbound messages">
        {inbound.length === 0 ? (
          <EmptyState title="No inbound messages yet" hint="The simulator can create demo traffic." />
        ) : (
          <ul className="divide-y divide-zinc-800">
            {inbound.map((message) => (
              <li key={message.id} className="flex flex-col gap-1 px-1 py-3 sm:flex-row sm:items-center sm:gap-3">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                  {message.eventType}
                </span>
                <MaskedPhone phone={message.phone} />
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{message.body}</span>
                <span className="text-xs text-zinc-500">
                  {new Date(message.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div id="failures">
        <Card title="Delivery failures">
          {failures.length === 0 ? (
            <EmptyState title="No delivery failures" />
          ) : (
            <ul className="divide-y divide-zinc-800">
              {failures.map((failure) => (
                <li key={failure.id} className="px-1 py-3">
                  <div className="flex items-center gap-2 text-xs text-red-400">
                    <span className="font-mono">{failure.eventType}</span>
                    {failure.incidentId && (
                      <span className="text-zinc-500">incident recorded</span>
                    )}
                  </div>
                  <MaskedPhone phone={failure.phone} />
                  <p className="mt-1 text-sm text-zinc-300">{failure.errorDetails}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
