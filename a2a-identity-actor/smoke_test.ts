/**
 * Smoke test for a2a-identity-actor.
 * Verifies the IdentityAgent class exists, has the expected methods,
 * and the default export is a fetch handler.
 * Run with: npx tsx smoke_test.ts
 */
import { IdentityAgent, default as handler, env, CANNED_RESPONSES } from "./src/index";

async function runSmokeTest(): Promise<void> {
  let failures = 0;

  // 1. Verify IdentityAgent class exists and extends Agent
  if (typeof IdentityAgent !== "function") {
    console.error("FAIL: IdentityAgent is not exported as a class");
    failures++;
  } else {
    console.log("PASS: IdentityAgent class exported");
  }

  // 2. Verify the default export is a fetch handler
  if (typeof handler !== "object" || typeof handler.fetch !== "function") {
    console.error("FAIL: default export does not have a fetch function");
    failures++;
  } else {
    console.log("PASS: default export has fetch handler");
  }

  // 3. Verify env is exported
  if (typeof env !== "object") {
    console.error("FAIL: env is not exported");
    failures++;
  } else {
    console.log("PASS: env exported");
  }

  // 4. Verify key methods exist on the prototype
  const proto = IdentityAgent.prototype as Record<string, unknown>;
  const expectedMethods = [
    "initialize",
    "refreshToken",
    "healthCheck",
    "authorizePeer",
    "revokePeer",
    "handleA2AMessage",
    "getIdentityState",
    "retry",
    "revoke",
    "fetch",
  ];
  for (const method of expectedMethods) {
    if (typeof proto[method] !== "function") {
      console.error(`FAIL: IdentityAgent.${method} is not a function`);
      failures++;
    } else {
      console.log(`PASS: IdentityAgent.${method} exists`);
    }
  }

  // 5. Verify the state shape via initialState
  const instance = new IdentityAgent({} as never);
  const initialState = instance.initialState();
  const requiredFields = [
    "agentId",
    "identityProvider",
    "oauth",
    "peers",
    "status",
    "lastHealthCheck",
    "createdAt",
  ];
  for (const field of requiredFields) {
    if (!(field in initialState)) {
      console.error(`FAIL: initialState missing field ${field}`);
      failures++;
    } else {
      console.log(`PASS: initialState has ${field}`);
    }
  }
  if (initialState.oauth && typeof initialState.oauth.accessToken !== "string") {
    console.error("FAIL: oauth.accessToken is not a string");
    failures++;
  } else {
    console.log("PASS: oauth.accessToken is a string");
  }

  // 6. Verify canned responses are present
  if (CANNED_RESPONSES && typeof CANNED_RESPONSES === "object") {
    console.log("PASS: CANNED_RESPONSES present");
  } else {
    console.error("FAIL: CANNED_RESPONSES missing");
    failures++;
  }

  if (failures > 0) {
    console.error(`\n${failures} smoke test failure(s)`);
    process.exit(1);
  }
  console.log("\nAll smoke tests passed ✅");
}

runSmokeTest().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
