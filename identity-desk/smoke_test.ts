/**
 * Smoke test for identity-desk. Runs with: npx tsx smoke_test.ts
 * Verifies the actor class, its RPC surface, the ledger schema, the lookup
 * normalizer, and the HTTP handler's input validation \u2014 no network required.
 */
import { Agent, rpcSurface } from "@telnyx/edge-runtime";
import worker, {
  CREATE_SNAPSHOT_TABLE,
  IdentityDesk,
  LOOKUP_TYPES,
  digitsOfE164,
  normalizeE164,
  normalizeLookup,
} from "./src/index";

let failures = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

async function runSmokeTest(): Promise<void> {
  check("IdentityDesk extends Agent", IdentityDesk.prototype instanceof Agent);
  check(
    "onIntakeCaptured is callable",
    typeof (IdentityDesk.prototype as any).onIntakeCaptured === "function",
  );
  check("identity rpc is callable", typeof (IdentityDesk.prototype as any).identity === "function");
  check("onDelta is implemented", typeof (IdentityDesk.prototype as any).onDelta === "function");
  check("runLookup is implemented", typeof (IdentityDesk.prototype as any).runLookup === "function");
  check("fileSnapshot is implemented", typeof (IdentityDesk.prototype as any).fileSnapshot === "function");
  check("fetch handler exported", typeof worker.fetch === "function");
  check("rpcSurface exported", typeof rpcSurface === "function");
  check("multi-type lookup", LOOKUP_TYPES.join(",") === "carrier,enhanced-caller-name");

  const columns = [
    "phone_e164",
    "looked_up_at",
    "source_type",
    "carrier_name",
    "line_type",
    "ported_status",
    "caller_name",
    "entity_type",
    "confidence_score",
  ];
  check(
    "identity_snapshot schema",
    columns.every((column) => CREATE_SNAPSHOT_TABLE.includes(column)),
  );

  check("normalizeE164 formats", normalizeE164("+1 (555) 010-1999") === "+15550101999");
  check("normalizeE164 rejects junk", normalizeE164("not-a-number") === null);
  check("digitsOfE164", digitsOfE164("+15550101999") === "15550101999");

  const record = normalizeLookup({
    carrier: { name: "Google Fi", type: "mobile" },
    portability: { ported_status: "Y", normalized_carrier: "Google Fi" },
    enhanced_caller_name: { caller_name: "Martha Reyes", entity_type: "person" },
    caller_identity: { confidence_score: 80 },
  });
  check(
    "normalizeLookup maps fields",
    record.carrier_name === "Google Fi" &&
      record.line_type === "mobile" &&
      record.ported_status === "Y" &&
      record.entity_type === "person" &&
      record.confidence_score === 80,
  );

  const notFound = await worker.fetch(new Request("https://identity-desk.test/nope"), {} as any);
  check("unknown route -> 404", notFound.status === 404);

  const badIntake = await worker.fetch(
    new Request("https://identity-desk.test/intake", {
      method: "POST",
      body: JSON.stringify({ phoneE164: "nope" }),
    }),
    {} as any,
  );
  check("invalid intake -> 400", badIntake.status === 400);

  const badIdentity = await worker.fetch(
    new Request("https://identity-desk.test/identity/not-a-number"),
    {} as any,
  );
  check("invalid identity path -> 400", badIdentity.status === 400);

  if (failures > 0) {
    console.error(`${failures} smoke check(s) failed`);
    process.exit(1);
  }
  console.log("identity-desk smoke test passed");
}

runSmokeTest().catch((error) => {
  console.error(error);
  process.exit(1);
});
