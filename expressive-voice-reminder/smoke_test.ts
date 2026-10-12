import assert from "node:assert/strict";
import {
  ReminderQueueModel,
  actorNameForClinic,
  buildSpeakPayload,
  demoAppointments,
  reminderScript,
} from "./src/index.js";

assert.equal(actorNameForClinic("Clinic 42"), "reminder-queue-clinic-42");

const model = new ReminderQueueModel({
  OUTBOUND_TEXML_APP_ID: "texml_123",
  OUTBOUND_CALLER_ID: "+15551234567",
  RETRY_MAX: "3",
  RETRY_BACKOFF_BASE_MS: "1000",
  MAX_CALL_MINUTES: "300",
});

const opened = model.enqueue("clinic-42", demoAppointments());
assert.equal(opened.actorName, "reminder-queue-clinic-42");
assert.equal((opened.dictionaryPayload as { items: unknown[] }).items.length, 2);
assert.equal((opened.assistantPayload as any).voice_settings.expressive_mode, true);
assert.equal((opened.assistantPayload as any).post_conversation_settings.enabled, true);
assert.deepEqual((opened.assistantPayload as any).enabled_features, ["telephony"]);
assert.equal((opened.assistantPayload as any).dynamic_variables.pronunciation_dict_id, "dict_clinic-42");

const first = opened.next as any;
assert.equal(first.dialPayload.AIAssistantId, "reminder-assistant-clinic-42");
assert.equal(first.dialPayload.dynamic_variables.pronunciation_dict_id, "dict_clinic-42");
assert.match(first.script, /<emotion value='warm' \/>/);
assert.match(first.alternateScript, /<emotion value='concerned' \/>/);

const speak = model.repeatAddress("p-nguyen");
assert.equal(speak.pronunciation_dict_id, "dict_clinic-42");
assert.match(String(speak.payload), /Nguyen/);

model.recordOutcome("p-nguyen", "no-answer", "voicemail", new Date("2026-10-12T09:00:00Z"));
let snapshot = model.snapshot() as any;
assert.equal(snapshot.records[0].status, "no-answer");
assert.equal(snapshot.records[0].attempts, 1);
assert.ok(snapshot.records[0].nextRetryAt);

const restarted = new ReminderQueueModel({ RETRY_MAX: "3", RETRY_BACKOFF_BASE_MS: "1000" }, snapshot);
const retry = restarted.retryDue(new Date("2026-10-12T09:01:00Z")) as any;
assert.equal(retry.patientId, "p-nguyen");
assert.equal((restarted.snapshot() as any).records[0].attempts, 2);

restarted.recordOutcome("p-nguyen", "confirmed", "patient said yes");
snapshot = restarted.snapshot() as any;
assert.equal(snapshot.records[0].status, "confirmed");
assert.equal(snapshot.cursor, 1);

assert.match(reminderScript(demoAppointments()[0], "concerned"), /<emotion value='concerned' \/>/);
assert.equal(buildSpeakPayload(demoAppointments()[0], "dict_123").pronunciation_dict_id, "dict_123");

console.log("expressive-voice-reminder smoke test passed");
