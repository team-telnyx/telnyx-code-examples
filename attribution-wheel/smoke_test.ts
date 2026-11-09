/**
 * Smoke test for the Attribution Wheel sample.
 * Run with: npx tsx smoke_test.ts
 */
import handler, { AttributionWheel } from "./src/index";

const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, fn: () => boolean | void): void {
  try {
    const out = fn();
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
check("initialState() is defined", () => typeof (AttributionWheel.prototype as any).initialState === "function");

for (const method of ["bootstrap", "sweep", "report", "seed", "simulate", "nightly"]) {
  check(`RPC surface exposes ${method}()`, () => typeof (AttributionWheel.prototype as any)[method] === "function");
}

check("default export exposes fetch()", () => typeof handler.fetch === "function");

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` \u2014 ${r.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} smoke check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${results.length} smoke checks passed.`);
