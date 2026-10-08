import assert from "node:assert/strict";
import { VoiceFraudGate, actorNameForAccount, type LedgerRow } from "./src/index.js";

const action = {
  accountId: "acct_123",
  caller: "+15558675309",
  action: "wire_transfer" as const,
  amountCents: 250000,
  destination: "external account",
};

assert.equal(actorNameForAccount("Acct 123"), "voice-fraud-gate-acct-123");

const cleanGate = new VoiceFraudGate({ OUTBOUND_CALLER_ID: "+15551234567", OUTBOUND_TEXML_APP_ID: "texml_123" });
const opened = cleanGate.requestSensitiveAction(action);
assert.equal(opened.outcome, "blocked_pending");
assert.equal((opened.assistantPayload?.telephony_settings as { deepfake_detection: boolean }).deepfake_detection, true);
assert.equal((opened.assistantPayload?.voice_settings as { expressive_mode: boolean }).expressive_mode, true);

const cleanDecision = cleanGate.recordDeepfakeResult("call_clean", "human", "2026-10-08T12:00:00.000Z");
assert.equal(cleanDecision.outcome, "proceed");
assert.equal(cleanGate.confirmSensitiveAction().outcome, "proceed");

const riskyGate = new VoiceFraudGate({ FLASHCALL_VERIFY_PROFILE_ID: "verify_123" });
riskyGate.requestSensitiveAction(action);
const riskyDecision = riskyGate.recordDeepfakeResult("call_risky", "ai_generated", "2026-10-08T12:00:00.000Z");
assert.equal(riskyDecision.outcome, "step_up_flashcall");
assert.equal(riskyDecision.flashcallPayload?.type, "flashcall");
assert.equal(riskyGate.confirmSensitiveAction().outcome, "blocked_pending");

const flaggedLedger: LedgerRow[] = [
  {
    accountId: "acct_123",
    ts: "2026-10-08T11:50:00.000Z",
    callSid: "call_old",
    deepfakeResult: "ai_generated",
    action: "wire_transfer",
    outcome: "step_up_flashcall",
    source: "deepfake_webhook",
    note: "synthetic voice detected",
  },
];
const restartGate = new VoiceFraudGate();
restartGate.requestSensitiveAction(action);
restartGate.rehydrateFromLedger(flaggedLedger);
const flaggedDecision = restartGate.recordDeepfakeResult("call_retry", "human", "2026-10-08T12:00:00.000Z");
assert.equal(flaggedDecision.outcome, "step_up_flashcall");

const errorGate = new VoiceFraudGate();
errorGate.requestSensitiveAction(action);
const errorDecision = errorGate.recordDeepfakeError("call_error", "provider timeout");
assert.equal(errorDecision.outcome, "manual_review");
assert.equal((errorGate.screenView() as { status: string }).status, "manual_review");

console.log("voice-fraud-step-up-agent smoke test passed");
