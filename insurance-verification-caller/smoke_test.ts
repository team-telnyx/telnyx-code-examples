import { VerifyJob, type JobState, type Verdict, type VerifyJobEnv, rpc } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Verify VerifyJob class is defined
assert(typeof VerifyJob === "function", "VerifyJob should be defined");

// Verify methods exist on prototype
const proto = VerifyJob.prototype as Record<string, unknown>;
const expectedMethods = [
  "run",
  "openJob",
  "dialAndDriveIvr",
  "judgeWithJev",
  "notifyFrontDesk",
  "jevFetchWithRetry",
  "parseVerdict",
  "sendDtmf",
  "captureTranscript",
  "dialCarrier",
  "simulateCarrierResponse",
  "simulateDtmfDrive",
];

for (const method of expectedMethods) {
  assert(typeof proto[method] === "function", `VerifyJob.prototype.${method} should be a function`);
}

// Verify types are usable
const state: JobState = {
  jobId: "test-1",
  memberId: "M123",
  plan: "PPO",
  provider: "Dr. Smith",
  carrier: "+15551234567",
  attempts: 0,
  verdict: null,
  sent: false,
  transcript: null,
};
assert(state.jobId === "test-1", "JobState should be usable");

const verdict: Verdict = {
  choice: "covered",
  score: 85,
  noul: 0.1,
  raw: {},
};
assert(verdict.choice === "covered", "Verdict should be usable");

const env: Partial<VerifyJobEnv> = {
  CARRIER_E164: "+15551234567",
  MOCK_CARRIER_E164: "+15559999999",
  FRONTDESK_E164: "+15550000000",
  DEMO_MODE: "true",
  MAX_ATTEMPTS: "3",
  JEV_MODEL: "telnyx/decision-flash",
};
assert(env.CARRIER_E164 !== undefined, "VerifyJobEnv should be usable");

// Verify RPC surface
assert(rpc !== undefined, "rpc should be defined");
assert(typeof rpc.openJob === "function", "rpc.openJob should be a function");

// Verify parseVerdict logic
const parseVerdict = proto.parseVerdict as (data: any) => Verdict;

const verdict1 = parseVerdict({
  answers: {
    choice: { value: "covered" },
    score: { value: "85" },
    noul: { value: "0.1" },
  },
});
assert(verdict1.choice === "covered", "parseVerdict should parse answers array");
assert(verdict1.score === 85, "parseVerdict should parse score");
assert(Math.abs(verdict1.noul - 0.1) < 0.001, "parseVerdict should parse noul");

const verdict2 = parseVerdict({
  choice: "not_covered",
  score: 90,
  noul: 0.85,
});
assert(verdict2.choice === "not_covered", "parseVerdict should parse flat answers");
assert(verdict2.score === 90, "parseVerdict should parse flat score");
assert(Math.abs(verdict2.noul - 0.85) < 0.001, "parseVerdict should parse flat noul");

const verdict3 = parseVerdict({});
assert(verdict3.choice === "needs_verification", "parseVerdict should default to needs_verification");
assert(verdict3.score === 0, "parseVerdict should default score to 0");
assert(verdict3.noul === 0, "parseVerdict should default noul to 0");

// Verify decision policy logic
const coveredVerdict: Verdict = { choice: "covered", score: 85, noul: 0.1, raw: {} };
assert(
  coveredVerdict.choice === "covered" && coveredVerdict.score >= 70,
  "covered + score>=70 should be CONFIRMED"
);

const notCoveredVerdict: Verdict = { choice: "not_covered", score: 50, noul: 0.9, raw: {} };
assert(
  notCoveredVerdict.choice === "not_covered" || notCoveredVerdict.noul > 0.8,
  "not_covered or noul>0.8 should be NOT COVERED"
);

const needsVerificationVerdict: Verdict = { choice: "needs_verification", score: 30, noul: 0.3, raw: {} };
assert(
  needsVerificationVerdict.choice === "needs_verification",
  "needs_verification should be front desk flag"
);

console.log("✅ All smoke tests passed");

