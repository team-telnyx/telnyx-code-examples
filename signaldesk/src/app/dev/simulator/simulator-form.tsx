"use client";

import { useActionState } from "react";
import { simulateInboundSms, type SimulatorResult } from "./actions";

const PRESETS: Array<{ label: string; from: string; body: string }> = [
  {
    label: "Sev1-style report",
    from: "+18005550123",
    body: "This is severe. The whole checkout API is down for everyone, customers are seeing 500s on every order.",
  },
  {
    label: "Ambiguous report",
    from: "+18005550123",
    body: "Something seems off with the dashboard, pages are loading slowly in Europe maybe?",
  },
  {
    label: "HELP",
    from: "+18005550123",
    body: "HELP",
  },
  {
    label: "STOP",
    from: "+18005550123",
    body: "STOP",
  },
  {
    label: "STATUS query",
    from: "+18005550123",
    body: "STATUS INC-000001",
  },
];

export function SimulatorForm() {
  const [result, formAction, pending] = useActionState<SimulatorResult | null, FormData>(
    simulateInboundSms,
    null,
  );  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <div>
          <label
            htmlFor="sim-from"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400"
          >
            From number
          </label>
          <input
            id="sim-from"
            name="from"
            type="tel"
            required
            placeholder="+18005550123"
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <div>
          <label
            htmlFor="sim-body"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400"
          >
            Message body
          </label>
          <textarea
            id="sim-body"
            name="body"
            rows={4}
            required
            placeholder="Checkout API is timing out for customers in us-east-1…"
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-60"
        >
          {pending ? "Processing…" : "Send as Telnyx would"}
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
            onClick={() => {
              const from = document.getElementById("sim-from") as HTMLInputElement | null;
              const body = document.getElementById("sim-body") as HTMLTextAreaElement | null;
              if (from) from.value = preset.from;
              if (body) body.value = preset.body;
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {result && (
        <div
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            result.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {result.ok ? (
            <>
              <span className="font-semibold">{result.handled}</span>
              {result.detail ? <> — {result.detail}</> : null}
              {result.incidentId ? (
                <>
                  {" "}
                  →{" "}
                  <a
                    className="underline underline-offset-2"
                    href={`/incidents/${result.incidentId}`}
                  >
                    {result.incidentNumber} opened
                  </a>
                </>
              ) : null}
            </>
          ) : (
            result.error
          )}
        </div>
      )}
    </div>
  );
}
