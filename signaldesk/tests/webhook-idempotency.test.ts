import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, client } from "../src/db";
import { messageEvents } from "../src/db/schema";
import {
  idempotencyKeyFor,
  parseWebhookEnvelope,
  planIngestion,
  UnknownMessageError,
} from "../src/lib/webhook-events";
import reportFixture from "../fixtures/message.received.report.json";
import deliveredFixture from "../fixtures/message.finalized.delivered.json";
import failedFixture from "../fixtures/message.finalized.failed.json";

process.env.SIGNALDESK_MOCK_SMS = "true";
process.env.SIGNALDESK_MOCK_AI = "true";
process.env.DATABASE_URL ??= "postgres://postgres:signaldesk@localhost:54329/signaldesk";

const TEST_KEY_PREFIX = "test-dedupe-";

describe("webhook envelope parsing", () => {
  it("parses a valid message.received fixture", () => {
    const raw = JSON.stringify(reportFixture);
    const envelope = parseWebhookEnvelope(raw);
    expect(envelope.data.event_type).toBe("message.received");
  });

  it("rejects non-JSON bodies", () => {
    expect(() => parseWebhookEnvelope("not json at all")).toThrow(UnknownMessageError);
  });

  it("rejects bodies that are not Telnyx envelopes", () => {
    expect(() => parseWebhookEnvelope("{}")).toThrow(UnknownMessageError);
    expect(() => parseWebhookEnvelope('{"data":{"nope":true}}')).toThrow(UnknownMessageError);
  });
});

describe("idempotency keys", () => {
  it("prefers the Telnyx event id", () => {
    const raw = JSON.stringify(reportFixture);
    const key = idempotencyKeyFor(parseWebhookEnvelope(raw), raw);
    expect(key).toBe(`evt:${reportFixture.data.id}`);
  });

  it("falls back to a body hash when no event id exists", () => {
    const noIdEnvelope = { data: { event_type: "message.received", payload: {} } };
    const raw = JSON.stringify(noIdEnvelope);
    const key = idempotencyKeyFor(noIdEnvelope as never, raw);
    expect(key).toMatch(/^evt-hash:[a-f0-9]+$/);
  });
});

describe("delivery webhook dedupe (database-backed)", () => {
  beforeEach(async () => {
    // Remove any leftovers from previous runs. Keys are stored with the
    // "evt:" prefix, so match on the middle segment.
    const keys = await db
      .select({ key: messageEvents.idempotencyKey })
      .from(messageEvents);
    for (const row of keys) {
      if (row.key.includes(TEST_KEY_PREFIX)) {
        await db.delete(messageEvents).where(eq(messageEvents.idempotencyKey, row.key));
      }
    }
  });

  it("records a delivery update once and reports duplicates for retries", async () => {
    const raw = JSON.stringify(deliveredFixture);
    // Rename the event so the test is isolated.
    const event = JSON.parse(raw);
    event.data.id = `${TEST_KEY_PREFIX}delivered-1`;
    const rawWithTestKey = JSON.stringify(event);

    const envelope = parseWebhookEnvelope(rawWithTestKey);
    const first = await planIngestion(envelope, rawWithTestKey);
    expect(first.response.handled).toBe("delivery");
    expect(first.background).toBeNull();

    const second = await planIngestion(envelope, rawWithTestKey);
    expect(second.response.handled).toBe("duplicate");

    const stored = await db
      .select()
      .from(messageEvents)
      .where(eq(messageEvents.idempotencyKey, `evt:${event.data.id}`));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.deliveryStatus).toBe("delivered");
  });

  it("marks message.finalized with errors as failed and stores the error", async () => {
    const event = JSON.parse(JSON.stringify(failedFixture));
    event.data.id = `${TEST_KEY_PREFIX}failed-1`;
    const rawWithTestKey = JSON.stringify(event);
    const envelope = parseWebhookEnvelope(rawWithTestKey);

    const result = await planIngestion(envelope, rawWithTestKey);
    expect(result.response.handled).toBe("delivery");

    const stored = await db
      .select()
      .from(messageEvents)
      .where(eq(messageEvents.idempotencyKey, `evt:${event.data.id}`));
    expect(stored[0]!.deliveryStatus).toBe("failed");
    expect(stored[0]!.errorDetails).toContain("10100");
  });

  it("dedupes inbound reports so a Telnyx retry cannot create two incidents", async () => {
    const event = JSON.parse(JSON.stringify(reportFixture));
    event.data.id = `${TEST_KEY_PREFIX}inbound-1`;
    const raw = JSON.stringify(event);
    const envelope = parseWebhookEnvelope(raw);

    const first = await planIngestion(envelope, raw);
    expect(first.response.handled).toBe("inbound");
    expect(first.background).not.toBeNull();

    const second = await planIngestion(envelope, raw);
    expect(second.response.handled).toBe("duplicate");
    expect(second.background).toBeNull();

    const stored = await db
      .select()
      .from(messageEvents)
      .where(eq(messageEvents.idempotencyKey, `evt:${event.data.id}`));
    expect(stored).toHaveLength(1);
  });
});

afterAll(async () => {
  await client.end();
});
