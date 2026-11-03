/**
 * Smoke test for otp-guard. Runs with: npx tsx smoke_test.ts
 *
 * Verifies the module loads, the actor class exposes the session methods the
 * router depends on, and the router's validation paths fail closed without
 * ever touching a live actor or the Telnyx API.
 */
import assert from "node:assert/strict";
import handler, {
  OtpGuard,
  MAX_ATTEMPTS,
  LOCKOUT_SECONDS,
  VERIFICATION_TIMEOUT_SECS,
  isActionId,
  isE164,
  isVerificationCode,
  maskPhone,
} from "./src/index";

async function runSmokeTest(): Promise<void> {
  // 1. Module shape \u2014 default fetch handler + exported actor class.
  assert.equal(typeof handler.fetch, "function", "default export must expose fetch()");
  assert.equal(typeof OtpGuard, "function", "OtpGuard must be exported");

  // 2. Actor methods the router RPCs into must exist on the prototype.
  const methods = [
    "onProfileCreated",
    "onActionRequested",
    "onCodeSubmitted",
    "onBudgetExhausted",
    "liftLockout",
    "onAuditQuery",
    "onVerifyWebhook",
  ];
  for (const method of methods) {
    assert.equal(
      typeof (OtpGuard.prototype as unknown as Record<string, unknown>)[method],
      "function",
      `OtpGuard.${method} is missing`,
    );
  }

  // 3. Step-up policy constants.
  assert.equal(MAX_ATTEMPTS, 3, "attempt budget must be 3");
  assert.equal(LOCKOUT_SECONDS, 600, "lockout must be 10 minutes");
  assert.equal(VERIFICATION_TIMEOUT_SECS, 300, "verification expiry must be 5 minutes");

  // 4. Input validators.
  assert.equal(isE164("+15551234567"), true);
  assert.equal(isE164("5551234567"), false);
  assert.equal(isE164("+1555123456789012"), false);
  assert.equal(isActionId("action-4471"), true);
  assert.equal(isActionId("../etc/passwd"), false);
  assert.equal(isActionId(""), false);
  assert.equal(isVerificationCode("123456"), true);
  assert.equal(isVerificationCode("12ab56"), false);
  assert.equal(isVerificationCode("1"), false);

  // 5. PII masking for anything leaving the actor.
  assert.equal(maskPhone("+15551234567"), "+1555***4567");
  assert.equal(maskPhone("+1555"), "***");

  // 6. Router validation paths \u2014 no actor binding required.
  const emptyEnv = {} as never;

  const notFound = await handler.fetch(new Request("https://example.com/nope"), emptyEnv);
  assert.equal(notFound.status, 404, "unknown route must 404");

  const badId = await handler.fetch(
    new Request("https://example.com/actions/..%2Fetc/start", { method: "POST" }),
    emptyEnv,
  );
  assert.equal(badId.status, 400, "path-traversal action id must be rejected");

  const badCode = await handler.fetch(
    new Request("https://example.com/actions/action-4471/submit", {
      method: "POST",
      body: JSON.stringify({ code: "abc" }),
    }),
    emptyEnv,
  );
  assert.equal(badCode.status, 400, "non-numeric code must be rejected before the actor is touched");

  const badPhone = await handler.fetch(
    new Request("https://example.com/actions/action-4471/start", {
      method: "POST",
      body: JSON.stringify({ phone_number: "5551234567" }),
    }),
    emptyEnv,
  );
  assert.equal(badPhone.status, 400, "non-E.164 phone must be rejected");

  const wrongMethod = await handler.fetch(
    new Request("https://example.com/actions/action-4471/audit", { method: "POST" }),
    emptyEnv,
  );
  assert.equal(wrongMethod.status, 405, "audit is GET-only");

  // 7. Webhook fails closed when the signing key is not configured.
  const noKeyEnv = { SECRETS: { get: async () => null } } as never;
  const webhook = await handler.fetch(
    new Request("https://example.com/webhooks/verify", { method: "POST", body: "{}" }),
    noKeyEnv,
  );
  assert.equal(webhook.status, 503, "webhook must fail closed without TELNYX_PUBLIC_KEY");

  console.log("smoke_test: all checks passed");
}

runSmokeTest().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
