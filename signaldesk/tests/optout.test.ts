import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, client } from "../src/db";
import { incidents, subscribers } from "../src/db/schema";
import { optInPhone, optOutPhone, isPhoneOptedOut } from "../src/lib/incidents";
import { listActiveSubscribers, notifyStatusChange } from "../src/lib/messaging";
import { parseSmsCommand } from "../src/lib/commands";

process.env.SIGNALDESK_MOCK_SMS = "true";
process.env.DATABASE_URL ??= "postgres://postgres:signaldesk@localhost:54329/signaldesk";

const PHONE = "+19995551111";
const OPTED_OUT = "+19995552222";
const OTHER = "+19995553333";

let incidentId: string;

beforeEach(async () => {
  await db.delete(subscribers).where(eq(subscribers.phone, PHONE));
  await db.delete(subscribers).where(eq(subscribers.phone, OPTED_OUT));
  await db.delete(subscribers).where(eq(subscribers.phone, OTHER));
  await db.delete(incidents).where(eq(incidents.number, "INC-999998"));
  const inserted = await db
    .insert(incidents)
    .values({
      number: "INC-999998",
      title: "Test incident (opt-out suite)",
      summary: "Temporary incident used by opt-out tests.",
      severity: "SEV3",
      status: "INVESTIGATING",
      affectedService: "test-service",
      affectedRegion: null,
      symptoms: "synthetic test data",
      suggestedNextAction: "delete this row",
      confidence: 0.5,
      reporterPhone: PHONE,
      sourceMessageId: "test-source",
    })
    .onConflictDoNothing()
    .returning();
  incidentId = inserted[0]?.id ?? (await db.select().from(incidents).where(eq(incidents.number, "INC-999998")))[0]!.id;
});

describe("opt-out enforcement", () => {
  it("marks a phone as opted out globally across all incidents", async () => {
    await db.insert(subscribers).values([
      { incidentId, phone: PHONE },
      {
        incidentId,
        phone: OTHER,
      },
    ]);
    expect(await isPhoneOptedOut(PHONE)).toBe(false);

    const changed = await optOutPhone(PHONE);
    expect(changed).toBe(1);
    expect(await isPhoneOptedOut(PHONE)).toBe(true);

    // Idempotent: a repeated STOP produces no new changes.
    const again = await optOutPhone(PHONE);
    expect(again).toBe(0);
  });

  it("never selects opted-out numbers as notification recipients", async () => {
    await db.insert(subscribers).values([
      { incidentId, phone: PHONE },
      { incidentId, phone: OPTED_OUT, active: false, optedOutAt: new Date() },
    ]);

    const recipients = await listActiveSubscribers(incidentId);
    expect(recipients.map((r) => r.phone).sort()).toEqual([PHONE].sort());
  });

  it("restores consent on START", async () => {
    await db.insert(subscribers).values({
      incidentId,
      phone: PHONE,
      active: false,
      optedOutAt: new Date(),
    });

    await optInPhone(PHONE);
    expect(await isPhoneOptedOut(PHONE)).toBe(false);

    const recipients = await listActiveSubscribers(incidentId);
    expect(recipients.map((r) => r.phone)).toContain(PHONE);
  });

  it("returns zero sends when every subscriber opted out", async () => {
    await db.insert(subscribers).values({
      incidentId,
      phone: OPTED_OUT,
      active: false,
      optedOutAt: new Date(),
    });

    const result = await notifyStatusChange({
      incidentNumber: "INC-000001",
      incidentId,
      previousStatus: "INVESTIGATING",
      newStatus: "IDENTIFIED",
      operatorNote: null,
    });
    expect(result.sent).toBe(0);
  });

  it("STOP command parsing routes to the opt-out flow", () => {
    expect(parseSmsCommand("QUIT")).toEqual({ type: "stop" });
    expect(parseSmsCommand("cancel")).toEqual({ type: "stop" });
  });
});

afterAll(async () => {
  // Keep the developer database clean: remove the synthetic incident.
  await db.delete(incidents).where(eq(incidents.number, "INC-999998"));
  await client.end();
});
