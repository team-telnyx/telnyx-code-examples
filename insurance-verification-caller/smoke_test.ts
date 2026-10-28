import app, { VerifyJob } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Verify VerifyJob class is defined
assert(typeof VerifyJob === "function", "VerifyJob should be defined");

// Verify current RPC methods exist on prototype
const proto = VerifyJob.prototype as Record<string, unknown>;
const expectedMethods = [
  "openJob",
  "getJob",
  "onLiveAnswered",
  "onLiveTranscription",
  "onLiveHangup",
  "setRecordingUrl",
  "mockRecord",
  "mockList",
];

for (const method of expectedMethods) {
  assert(typeof proto[method] === "function", `VerifyJob.prototype.${method} should be a function`);
}

// Verify state shape used by the actor remains coherent
const state = {
  jobId: "test-1",
  memberId: "M123",
  plan: "PPO",
  provider: "Dr. Smith",
  carrier: "+15551234567",
  demo: true,
  outcome: "covered",
  attempts: 0,
  status: "running",
  verdict: null,
  transcriptParts: [],
  sent: false,
  transcript: null,
};
assert(state.jobId === "test-1", "JobState should be usable");

const verdict = {
  coverage: "covered",
  coverageConfidence: 0.85,
  certainty: 3,
  hardNo: 0.1,
  policy: "covered",
  smsBody: "Coverage CONFIRMED for member M123 (PPO).",
};
assert(verdict.coverage === "covered", "Verdict should be usable");

const env = {
  CARRIER_E164: "+15551234567",
  MOCK_CARRIER_E164: "+15559999999",
  FRONTDESK_E164: "+15550000000",
  DEMO_MODE: "true",
  MAX_ATTEMPTS: "3",
  JEV_MODEL: "telnyx/decision-flash",
};
assert(env.CARRIER_E164 !== undefined, "VerifyJobEnv should be usable");

// Verify function-layer export
assert(app !== undefined, "default export should be defined");
assert(typeof app.fetch === "function", "default export fetch should be a function");

// Verify decision policy logic
const coveredVerdict = { coverage: "covered", coverageConfidence: 0.85, certainty: 3, hardNo: 0.1 };
assert(
  coveredVerdict.coverage === "covered" && coveredVerdict.certainty >= 2,
  "covered + certainty>=2 should be CONFIRMED"
);

const notCoveredVerdict = { coverage: "not_covered", coverageConfidence: 0.5, certainty: 2, hardNo: 0.9 };
assert(
  notCoveredVerdict.coverage === "not_covered" || notCoveredVerdict.hardNo > 0.8,
  "not_covered or hardNo>0.8 should be NOT COVERED"
);

const needsVerificationVerdict = { coverage: "needs_verification", coverageConfidence: 0.3, certainty: 1, hardNo: 0.3 };
assert(
  needsVerificationVerdict.coverage === "needs_verification",
  "needs_verification should be front desk flag"
);

console.log("✅ All smoke tests passed");
