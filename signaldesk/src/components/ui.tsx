import type { ReactNode } from "react";
import type { Severity } from "@/lib/severity";
import { severityLabel } from "@/lib/severity";
import type { Status } from "@/lib/status";

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const severityStyles: Record<Severity, string> = {
  SEV1: "bg-red-500/15 text-red-400 border-red-500/40",
  SEV2: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  SEV3: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40",
  SEV4: "bg-sky-500/15 text-sky-400 border-sky-500/40",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs font-semibold ${severityStyles[severity]}`}
      title={severityLabel(severity)}
    >
      {severity}
    </span>
  );
}

const statusStyles: Record<Status, string> = {
  INVESTIGATING: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  IDENTIFIED: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  MONITORING: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  RESOLVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded border border-dashed border-zinc-800 px-4 py-10 text-center">
      <p className="text-sm font-medium text-zinc-400">{title}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function MaskedPhone({ phone }: { phone: string }) {
  const masked = maskForDisplay(phone);
  return (
    <span className="font-mono text-xs text-zinc-400" title="Number is masked">
      {masked}
    </span>
  );
}

function maskForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return "••••";
  return `+${digits.slice(0, 2) ?? "1"} ••• ••• ${digits.slice(-4)}`;
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      {message}
    </div>
  );
}

export function SuccessNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
    >
      {message}
    </div>
  );
}
