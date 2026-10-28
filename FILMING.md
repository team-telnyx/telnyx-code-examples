# Voice Fraud Step-Up Agent — filming script

This is the live-call take. Do not open `.env` on camera. Running `npm run demo:live` places one outbound call to the configured `TARGET_PHONE`.

Target length: 6–8 minutes.

## Before recording

Use one screen with two windows side by side:

- left: this project in your editor
- right: a terminal at `voice-fraud-step-up-agent`

Keep the editor font large enough to read on video. Hide the sidebar and unrelated tabs. Do not show secrets, `.env`, API keys, phone numbers, or terminal history from another project.

Start with the editor on `README.md` and the terminal at a clean prompt with this command typed but not yet executed:

```bash
npm run demo:live
```

## 0. Opening — README.md (30 seconds)

### Put on screen

Show the opening section of `README.md`. Keep the terminal visible but idle.

### Say

“This sample is a fraud gate for high-risk account actions like wire transfers, password resets, and payout changes. The key design principle is that the AI assistant can hold the conversation, but it can never make the risk decision. The decision lives in code, backed by an append-only ledger, so it survives restarts and stays auditable. I’ll show the policy, the runtime wiring, and then run the complete live demo.”

## 1. Edge wiring — telnyx.toml (30 seconds)

### Put on screen

Open `telnyx.toml`. Show the actor binding, secrets block, and environment variables. Scroll slowly only if needed.

### Say

“This is the Edge Compute wiring. The actor binding maps `FRAUD_GATES` to the `VoiceFraudGate` class, so each account gets its own durable instance from its account ID. Secrets are declared as runtime secrets instead of being embedded in source. The remaining values are dial configuration. The deployment ceremony is `telnyx-edge types`, followed by `telnyx-edge ship`.”

## 2. Policy types — src/index.ts (45 seconds)

### Put on screen

Open `src/index.ts` at the top. Show `DeepfakeResult`, the payload types, and `GateState`.

### Say

“The implementation starts from the API contracts. A detection result is explicitly real, fake, or silence timeout, with a score and consistency value. The dial payload carries deepfake detection, client state, and a per-call webhook URL. The durable gate state contains the pending action, call information, ledger rows, and the count of rows mirrored to SQL.”

## 3. The policy engine — src/index.ts (2 minutes)

### Put on screen

Find `VoiceFraudGateModel`. Keep the method name visible while you scroll through these methods in order:

1. `requestSensitiveAction`
2. `buildDialPayload`
3. `recordDeepfakeResult`
4. `decideFromLedger`
5. `hasRecentFlag`
6. `confirmSensitiveAction`
7. `rehydrateFromLedger`

### Say

“This class is the product. It is pure policy with no framework or I/O, which makes it unit-testable and portable between a laptop demo and the edge runtime.”

“`requestSensitiveAction` opens the gate for the account but immediately blocks the action. The first ledger row records `blocked_pending` and the source request.”

“`buildDialPayload` turns on voice fraud detection and places the account ID into `client_state`. When the webhook comes back, that state tells us exactly which account owns the call. There are no lookup tables.”

“The webhook result is recorded, and `decideFromLedger` derives the verdict. A real voice with a clean recent ledger can proceed. A fake voice, or any recent risky event on the account, requires step-up. A timeout goes to manual review.”

“The important detail is `hasRecentFlag`: one recent fake-voice event keeps the account hot. A clean voice later that day does not erase the risk.”

“Finally, `confirmSensitiveAction` only succeeds when the latest ledger outcome is `proceed`. The assistant cannot overrule the ledger. `rehydrateFromLedger` proves that the same verdict comes back after a restart.”

## 4. Runtime actor — src/index.ts (90 seconds)

### Put on screen

Find the `VoiceFraudGate` class. Show the class declaration, then briefly show:

- secret/model environment access
- `requestSensitiveAction`
- `playVerificationPrompt`
- `recordDeepfakeResult`
- `persistModel`

### Say

“The model is the policy; this actor is the runtime. `VoiceFraudGate` extends the Telnyx Edge Agent runtime and owns persistence, RPC, and embedded SQL.”

“Secrets are read through the runtime environment and never from source code. In production, the actor creates or updates the assistant idempotently, places the Call Control dial with deepfake detection enabled, and intentionally does not attach the assistant yet.”

“When the call answers, the actor plays a short verification prompt. The detection webhook then arrives. Only after the verdict does the actor fire flashcall verification when needed and start the assistant with a greeting that already reflects the decision.”

“Every ledger row is mirrored into SQL exactly once, and processed webhook event IDs are recorded. That makes retries safe and gives the fraud team an append-only audit trail.”

## 5. Webhook front door — src/index.ts (60 seconds)

### Put on screen

Jump to the default export or `fetch` handler. Show the `/webhooks` branch.

### Say

“The webhook handler is deliberately a small, fail-closed switchboard. First it verifies the Ed25519 signature. Forged or unsigned events receive a 401 and are never processed. Next it decodes `client_state` to recover the account ID. Finally it routes the event to that account’s actor. The actor owns the decision; the function only authenticates and dispatches.”

## 6. Proof tests — smoke_test.ts (45 seconds)

### Put on screen

Open `smoke_test.ts`. Show the test names or assertions. Do not linger on unrelated setup.

### Say

“These tests are the acceptance criteria in miniature: a real voice on a clean ledger proceeds; a fake voice requires step-up and cannot confirm; a rehydrated ledger with a recent risk flag still steps up; and a detection error fails closed to manual review.”

## 7. Run the live demo — demo-live.ts and terminal (60–90 seconds)

### Put on screen

Open `demo-live.ts` in the editor. Do not run it until you are ready to place the outbound call. Then move focus to the terminal and run:

```bash
npm run demo:live
```

While it runs, leave the terminal full-size or zoomed enough that the numbered sections and final ledger are readable. Answer the call and respond to the verification prompt. Do not type over the output.

### Say

“This is the live Edge demo. The terminal is only a monitor: the deployed actor places the call, receives the signed detection webhook, and polls the actor’s audit ledger.”

“The gate opens a wire-transfer request, places a bare call with deepfake detection enabled, and waits for the signed result. The actor then derives the verdict from the ledger, starts the assistant only after that verdict, and exposes the final audit trail.”

When the final line appears, say:

“The AI can talk. The ledger decides.”

## 8. Explain the sequencing — demo-live.ts (60–90 seconds)

### Put on screen

Open `demo-live.ts`. Show the high-level flow only. Do not open `.env`, run the script, reveal configuration, or place a call.

### Say

“The live path loads credentials at runtime, verifies incoming webhook signatures at the deployed Edge function, and polls the actor’s status endpoint from this terminal.”

“The important sequencing is: first place a bare call with deepfake detection and no assistant; then play the verification prompt and wait for the detection result; then apply the ledger policy; and only after that start the assistant with the verdict. The assistant is the mouthpiece for the decision, never the decider.”

## 9. Deployment path — README.md (45–60 seconds)

### Put on screen

Return to the README deployment section. Avoid showing any actual secret values.

### Say

“Deployment is a short ceremony. Add the API and public-key secrets through the Edge CLI, set the dial and webhook configuration, generate types from `telnyx.toml`, and ship the function. After deployment, point the webhook URL at the function’s `/webhooks` route. The deployed actor then runs the same bare-dial, signed-webhook, ledger, and post-verdict assistant flow shown here.”

## 10. Closing (30 seconds)

### Put on screen

Return to the final terminal ledger or the README architecture summary.

### Say

“Detection is one dial parameter plus a signed webhook. The actor owns the policy and the audit trail. The assistant speaks, but the ledger decides — deterministically, restart-proof, and fail-closed. The pattern is simple: sequence your primitives, keep policy in code, and make every decision a row you can defend.”

## If you make a mistake

Pause for two seconds, repeat the sentence from the beginning, and continue. Do not stop the recording for small wording mistakes. If the terminal output becomes cluttered, start a new take with a clean terminal and run `npm run demo:live` again. Each run places one call.

## Final safety check

- No `.env` or API key is visible.
- No real phone number or outbound call is used.
- The terminal command shown is exactly `npm run demo:live`.
- The live path is explained but not executed.
- The final frame shows the audit ledger or README, not a secret/configuration file.
