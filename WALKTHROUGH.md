# Voice Fraud Step-Up Agent — Technical Walkthrough Script

A file-by-file code tour for screen recording. Total ~6-8 minutes. Reference
this doc on one side of the screen, code on the other. Say the `SAY:` lines,
open what `OPEN:` says.

---

## 0. Framing (30s — idle screen or README.md)

SAY: "This sample demonstrates a voice-authenticity gate for high-risk account
actions — wire transfers, password resets, and payout changes. Deepfake
Detection can tell us whether the audio appears human or synthetic, but it
does not prove who owns the account. A production flow still needs an
independent verification factor. The AI assistant can hold the conversation,
but it can never make the risk decision; that decision lives in code, backed
by an append-only ledger."

---

## 1. telnyx.toml — the Edge wiring (30s)

OPEN: telnyx.toml

SAY: "This is a Telnyx Edge Compute function. Three things matter here: the
actor binding — FRAUD_GATES maps the VoiceFraudGate class so every account
gets its own durable instance via env.FRAUD_GATES.idFromName(accountId); the
secrets block — the API key and the account's Ed25519 public key land as
runtime secrets, never in code; and env_vars for the dial config. Deploy is
one command: telnyx-edge types, then telnyx-edge ship."

---

## 2. src/index.ts — part one: the types (45s)

OPEN: src/index.ts — top of file

SAY: "Everything starts from the real API contracts. DeepfakeResult is the
literal set of values Telnyx's detection webhook sends: real, fake, or
silence_timeout — with a score from zero to one and a consistency percentage.
The payload types — AssistantPayload, DialPayload, FlashcallPayload — are
validated against the live OpenAPI spec; the dial carries deepfake_detection,
client_state, and a per-call webhook_url. GateState is the actor's durable
state: pending action, the call, the ledger, and how many ledger rows have
already been mirrored to SQL."

---

## 3. src/index.ts — part two: the policy engine (2 min — the heart)

OPEN: src/index.ts — VoiceFraudGateModel

SAY: "This class is the product. It's pure — no framework, no I/O — which is
why it's unit-testable and why it runs identically on your laptop and on the
edge."

- requestSensitiveAction: "opens the gate for the account and immediately
  blocks the action. Note the first ledger row: blocked_pending, source
  request."
- buildDialPayload: "the fraud detection turns on here — one parameter on the
  call. And client_state carries the accountId, base64-encoded: when Telnyx
  fires the detection webhook, it echoes this back, so the webhook knows
  exactly which account's actor owns that call. No lookup tables."
- recordDeepfakeResult: "the webhook handler. It records the result and
  immediately asks the ledger for the verdict."
- decideFromLedger: "THE POLICY. Read it with me: human-sounding audio with a
clean recent ledger passes this demo's voice-authenticity policy. A fake
voice, OR any recent risky event on this account — flashcall step-up.
silence_timeout — manual review. A real result is not identity proof; a
production transfer still needs an independent factor. The decision is
derived from the ledger alone, never from memory."
- hasRecentFlag: "this is account memory: one fake-voice event in the last 24
  hours keeps the account hot. A fraudster can't out-wait the gate, and a
  clean voice after a suspicious day still gets stepped up."
- confirmSensitiveAction: "the assistant's tool calls this to complete the
  action. It only succeeds when the last ledger outcome is proceed. The AI
  cannot overrule the ledger — full stop."
- rehydrateFromLedger: "restart recovery: feed it stored rows and the same
  decision falls out."

---

## 4. src/index.ts — part three: the actor (90s)

OPEN: src/index.ts — VoiceFraudGate (Agent subclass)

SAY: "The model is policy; the actor is the runtime. VoiceFraudGate extends
Agent from the Telnyx Edge runtime — a StatefulActor with persistence,
RPC, and its own embedded SQL database."

- secret/modelEnv: "secrets are read through env.SECRETS.get — declared in
  telnyx.toml, never in code."
- requestSensitiveAction: "when deployed, the actor does the real work:
  ensureAssistant creates or updates the Telnyx assistant idempotently by
  name, then places the actual Call Control dial — a bare call leg with
  deepfake detection enabled and the webhook pointed back at this function.
  The assistant is NOT attached on the dial — that's the sequencing lesson:
  it joins only after the verdict."
- playVerificationPrompt: "when the call is answered, the actor plays a
  short verification prompt — the IVR pattern the deepfake docs themselves
  recommend — so the remote party has something to respond to while the
  model listens."
- recordDeepfakeResult: "the verdict lands here. On a risky outcome with a
  verify profile configured, the actor fires the real flashcall
  verification. Then — and only then — it starts the assistant on the live
  call with ai_assistant_start and a greeting that delivers the verdict:
  approved, step-up required, or routed to review."
- persistModel: "every ledger row goes two places: actor state for the hot
  path, and this embedded SQL table — the append-only audit log the ticket
  requires. The mirroredRows counter means each row lands exactly once. And
  every processed webhook event id is recorded too — a Telnyx retry can
  never double-fire the prompt or double-record a verdict."

---

## 5. src/index.ts — part four: the webhook front door (90s)

OPEN: src/index.ts — default export fetch handler

SAY: "Telnyx calls this function directly. POST /webhooks does three things
in order, fail-closed."

- "One: verify the Ed25519 signature using the account's public key through
  the Telnyx SDK's unwrap helper. A forged or unsigned webhook gets a 401 —
  never processed."
- "Two: decode client_state to find the accountId."
- "Three: route the event to that account's actor — recordDeepfakeResult or
  recordDeepfakeError. The actor makes the decision; the function is just the
  switchboard. Anything else gets acknowledged and ignored."

---

## 6. smoke_test.ts — proof the policy is real (45s)

OPEN: smoke_test.ts

SAY: "Before any demo, the policy is proven by tests. Human-sounding audio on
a clean ledger passes this voice-authenticity policy. Fake voice — step-up,
and confirm is blocked. A rehydrated ledger with a recent flag — even fresh
human-sounding audio steps up. A detection error — fails closed to manual
review. These are the policy tests; a production transaction would add a
separate identity-verification test."

---

## 7. the live voice-authenticity demo — one command (60–90s)

OPEN: demo-live.ts, then RUN `npm run demo:live`

SAY: "This is the live demo. The deployed Edge function places one call with
Deepfake Detection enabled, receives the signed result, applies the ledger
policy, and exposes the audit trail. A real result means human-sounding audio,
not verified account identity."

---

## 8. demo-live.ts — the real thing (90s)

OPEN: demo-live.ts

SAY: "This is the live-call implementation. Watch the sequencing — this is the
important architectural lesson."

- "The demo loads the personal key at runtime — prefix only, never printed.
  It fetches the account's Ed25519 public key so incoming webhooks are
  signature-verified — forged events are rejected, we've tested that."
- "The deployed Edge function receives the webhook directly, so there is no
  local receiver or tunnel in this demo; the dial carries the per-call webhook
  override."
- "And the call flow is sequenced: dial with deepfake detection and NO
  assistant — a bare call leg. The caller speaks. The model classifies the
  audio. The verdict lands. Only THEN does the assistant join with the
  voice-authenticity result. The assistant is the mouthpiece for the policy,
  never the decider, and a production transaction still needs an independent
  identity factor."

---

## 9. Edge deployment — the path (60s)

OPEN: README.md — "Deploy to Edge Compute" section

SAY: "Shipping this is a short ceremony, and every piece it depends on has
already been validated against the live API — the payload shapes, the
signature verification, the webhook routing, the sequenced call flow. The
ship is the last mechanical step."

- "Secrets first: telnyx-edge secrets add TELNYX_API_KEY — the personal key
  the actor dials with — and TELNYX_PUBLIC_KEY, the account's Ed25519 public
  key from GET /v2/public_key, the same key the webhook route verifies
  signatures against. Plus the runtime values: TARGET_PHONE,
  OUTBOUND_CONNECTION_ID, OUTBOUND_CALLER_ID."
- "telnyx-edge types generates the binding types straight from telnyx.toml
  — the actor, the secrets, everything. telnyx-edge ship bundles and deploys
  the function; it comes back with a live https URL on telnyxcompute.com."
- "One post-ship step: point WEBHOOK_URL at the deployed function's
  /webhooks path. The dial carries that URL as a per-call webhook override —
  deepfake events route straight back into this function, and no shared Call
  Control configuration is ever touched."
- "From that moment the deployed actor runs the exact flow you just saw:
  bare dial with detection, verification prompt on answer, verdict webhook
  into the actor, SQL-mirrored ledger, and the assistant joins with the
  verdict. GET /demo/status shows the audit trail at any time."

---

## 10. Closing (30s)

SAY: "So: detection is one dial parameter plus a signed webhook. The actor
owns the policy and the audit trail. The assistant speaks, but the ledger
decides — deterministically, restart-proof, fail-closed. That's the pattern
worth stealing: sequence your primitives, keep policy in code, and make every
decision a row you can defend."
