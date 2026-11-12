/**
 * Smoke test for the Attribution Wheel sample.
 * Run with: npm test
 */
import handler, { AttributionWheel, normalizeSpendRow } from "./src/index";
import { renderDashboard } from "./src/ui";

const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, fn: () => boolean | void | Promise<boolean | void>): Promise<void> | void {
  try {
    const out = fn();
    if (out instanceof Promise) {
      return out.then(
        (v) => results.push({ name, ok: v !== false }),
        (err) => results.push({ name, ok: false, detail: (err as Error).message }),
      );
    }
    results.push({ name, ok: out !== false });
  } catch (err) {
    results.push({ name, ok: false, detail: (err as Error).message });
  }
}

check("module imports without throwing", () => true);
check("AttributionWheel is exported as a class", () => typeof AttributionWheel === "function");
check("AttributionWheel extends the Agent base class", () => {
  const proto = Object.getPrototypeOf(AttributionWheel.prototype);
  return typeof proto === "object" && proto !== null && proto !== Object.prototype;
});
check("initialState() is defined", () => typeof (AttributionWheel.prototype as Record<string, unknown>).initialState === "function");

for (const method of ["bootstrap", "sweep", "report", "seed", "simulate", "nightly"]) {
  check(`RPC surface exposes ${method}()`, () => typeof (AttributionWheel.prototype as Record<string, unknown>)[method] === "function");
}

check("default export exposes fetch()", () => typeof handler.fetch === "function");

check("normalizeSpendRow reads the real API shape (dimension_id)", () => {
  const row = normalizeSpendRow(
    { dimension_id: "support", requests: 62, input_tokens: 900, output_tokens: 300, spend: 0.72, reserved_spend: 0.01, unknown_requests: 2 },
    "2026-11-10",
  );
  return row.service === "support" && row.requests === 62 && row.spend === 0.72 && row.unknown_requests === 2;
});

check("normalizeSpendRow falls back for untagged rows", () => {
  const row = normalizeSpendRow({ dimension_id: null, requests: 1 }, "2026-11-10");
  return row.service === "unknown";
});

check("renderDashboard returns Telnyx-branded HTML", () => {
  const html = renderDashboard({
    day: "2026-11-10",
    group: "main",
    demo: true,
    report: {
      day: "2026-11-10",
      rows: [
        {
          date: "2026-11-10",
          service: "support",
          requests: 620,
          input_tokens: 558000,
          output_tokens: 186000,
          spend: 0.558,
          reserved_spend: 0,
          unknown_requests: 0,
          baseline_ratio: 3.1,
          breach: 1,
          source: "synthetic",
          note: "anomaly",
        },
      ],
      totals: { requests: 620, input_tokens: 558000, output_tokens: 186000, spend: 0.558, reserved_spend: 0, unknown_requests: 0 },
      byTenant: [{ value: "acme", requests: 620, spend: 0.558 }],
      byEnv: [{ value: "prod", requests: 620, spend: 0.558 }],
      usage: null,
    },
    error: null,
  });
  return html.includes("Telnyx") && html.includes("Attribution Wheel") && html.includes("ANOMALY") && html.includes("<svg");
});

check("renderDashboard renders the empty state without throwing", () => {
  const html = renderDashboard({ day: "2026-11-10", group: "main", demo: true, report: null, error: "day must be YYYY-MM-DD" });
  return html.includes("No ledger rows") && html.includes("traffic.py");
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} smoke check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${results.length} smoke checks passed.`);
