// Smoke test: verifies the module loads, the actors expose their RPC surface,
// and the triage/chart parsers behave. Run with: npx tsx smoke_test.ts
import worker, { ClinicDesk, NightNurse, RotaDesk, extractFacts, splitTriage, triageFromTranscript } from "./src/index";

let passed = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function hasMethods(target: object, methods: string[]): void {
  const proto = target as unknown as Record<string, unknown>;
  for (const method of methods) {
    assert(typeof proto[method] === "function", `missing method: ${method}`);
  }
}

check("default export exposes a fetch handler", () => {
  assert(typeof worker.fetch === "function", "fetch handler is missing");
});

check("NightNurse exposes chat / ingestConversation / pageOnCall / report", () => {
  hasMethods(NightNurse.prototype, ["chat", "ingestConversation", "pageOnCall", "report", "initialState"]);
});

check("RotaDesk exposes current / setNumber", () => {
  hasMethods(RotaDesk.prototype, ["current", "setNumber", "initialState"]);
});

check("ClinicDesk exposes arm / report / dailyHandoff", () => {
  hasMethods(ClinicDesk.prototype, ["arm", "report", "dailyHandoff", "initialState"]);
});

check("splitTriage extracts the verdict suffix and strips it", () => {
  const parsed = splitTriage("Call 911 now.\nTRIAGE: page-on-call");
  assert(parsed.triage === "page-on-call", `unexpected triage: ${parsed.triage}`);
  assert(parsed.text === "Call 911 now.", `unexpected text: ${parsed.text}`);
});

check("splitTriage defaults to appointment when the suffix is missing", () => {
  assert(splitTriage("Drink fluids and rest.").triage === "appointment", "safe default missing");
});

check("extractFacts records red flags, pregnancy weeks, meds and allergies", () => {
  const facts = extractFacts("chest tightness since dinner, 32 weeks pregnant, taking labetalol, allergic to penicillin");
  assert(facts.redFlag === true, "red flag not detected");
  assert(facts.pregnancyWeeks === 32, `unexpected weeks: ${facts.pregnancyWeeks}`);
  assert(facts.symptoms.includes("chest tightness"), "chest tightness symptom missing");
  assert(facts.meds.includes("labetalol"), "med not captured");
  assert(facts.allergies.some((a) => a.startsWith("penicillin")), "allergy not captured");
});

check("extractFacts leaves a benign message unflagged", () => {
  const facts = extractFacts("mild heartburn after dinner, no other symptoms");
  assert(facts.redFlag === false, "benign message flagged as red flag");
  assert(facts.symptoms.length === 0, "unexpected symptoms recorded");
});

check("triageFromTranscript picks the latest assistant verdict", () => {
  const verdict = triageFromTranscript([
    { role: "user", text: "chest tightness since dinner" },
    { role: "assistant", text: "Call 911 now.\nTRIAGE: page-on-call" },
    { role: "user", text: "ok thank you" },
    { role: "assistant", text: "Glad to hear it.\nTRIAGE: appointment" },
  ]);
  assert(verdict === "appointment", `unexpected transcript triage: ${verdict}`);
});

check("triageFromTranscript ignores user turns and tool messages", () => {
  const verdict = triageFromTranscript([
    { role: "tool", text: "TRIAGE: self-care" },
    { role: "user", text: "TRIAGE: self-care" },
  ]);
  assert(verdict === "appointment", "user/tool text should not become the verdict");
});

console.log(`\n${passed} smoke checks passed`);
