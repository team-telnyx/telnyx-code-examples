/**
 * Seed script: inserts realistic fictional incidents, updates, subscribers,
 * and message events so the dashboard has meaningful data immediately.
 *
 *   npm run seed
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, client } from "../src/db";
import {
  incidentUpdates,
  incidents,
  messageEvents,
  subscribers,
} from "../src/db/schema";
import { formatIncidentNumber } from "../src/lib/incident-number";

interface SeedIncident {
  title: string;
  summary: string;
  severity: "SEV1" | "SEV2" | "SEV3" | "SEV4";
  status: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
  affectedService: string;
  affectedRegion: string | null;
  symptoms: string;
  suggestedNextAction: string;
  confidence: number;
  reporterPhone: string;
  inboundBody: string;
  minutesAgo: number;
  history: Array<{
    newStatus: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
    note: string | null;
    minutesAgo: number;
  }>;
}

const SEED_REPORTER = "+18005550123";
const SEED_REPORTER_2 = "+14155550187";

const SEED: SeedIncident[] = [
  {
    title: "Checkout API returning 500s for all orders",
    summary:
      "Reporter states the checkout API is failing on every order with 500 errors since 14:05 UTC. Payments are not being captured and revenue is affected.",
    severity: "SEV1",
    status: "IDENTIFIED",
    affectedService: "checkout-api",
    affectedRegion: "us-east-1",
    symptoms: "HTTP 500 on POST /checkout, error spike in Sentry, no successful payments",
    suggestedNextAction: "Page checkout on-call, inspect recent deploy for the payment client",
    confidence: 0.92,
    reporterPhone: SEED_REPORTER,
    inboundBody:
      "Severe issue: checkout is completely down for everyone, all orders are failing with 500 errors since about 14:05 UTC.",
    minutesAgo: 95,
    history: [
      { newStatus: "IDENTIFIED", note: "Bad config rolled to prod 14:02 UTC, rolling back", minutesAgo: 70 },
    ],
  },
  {
    title: "Dashboard pages loading slowly in Europe",
    summary:
      "Reports of slow dashboard page loads concentrated in Europe. No errors seen yet; suspected CDN cache miss storm.",
    severity: "SEV3",
    status: "MONITORING",
    affectedService: "web-dashboard",
    affectedRegion: "eu-central-1",
    symptoms: "p95 latency 4.2s (baseline 1.1s), no increase in error rate",
    suggestedNextAction: "Check CDN hit ratio and origin load in eu-central-1",
    confidence: 0.78,
    reporterPhone: SEED_REPORTER,
    inboundBody:
      "Something seems off with the dashboard, pages are loading slowly in Europe maybe? nobody has reported errors though",
    minutesAgo: 240,
    history: [
      { newStatus: "IDENTIFIED", note: "CDN edge cache miss spike in FRA", minutesAgo: 200 },
      { newStatus: "MONITORING", note: "Cache warmed, latency recovering", minutesAgo: 120 },
    ],
  },
  {
    title: "SMS notifications delayed on toll-free sender",
    summary:
      "Subscriber confirms status-update texts arrive 6-10 minutes late on the toll-free sender. Carrier queueing suspected.",
    severity: "SEV3",
    status: "INVESTIGATING",
    affectedService: "sms-notifications",
    affectedRegion: null,
    symptoms: "Delivery delays 6-10 min, all other KPIs normal",
    suggestedNextAction: "Query Telnyx message events for DLR timestamps by carrier",
    confidence: 0.64,
    reporterPhone: SEED_REPORTER_2,
    inboundBody: "FYI the status update texts are arriving like 6 to 10 minutes late today",
    minutesAgo: 55,
    history: [],
  },
  {
    title: "Login page intermittently unreachable for SSO customers",
    summary:
      "One corporate SSO customer cannot reach the login page intermittently. Other customers unaffected so far; route flap suspected.",
    severity: "SEV2",
    status: "INVESTIGATING",
    affectedService: "login-portal",
    affectedRegion: null,
    symptoms: "Connection refused ~30% of attempts from one AS, curl timeouts",
    suggestedNextAction: "Check BGP route announcements and load balancer health for the SSO VIP",
    confidence: 0.7,
    reporterPhone: SEED_REPORTER_2,
    inboundBody:
      "Users at Acme cannot reach the login page at all right now, it times out. Everyone else seems fine. This is major for them.",
    minutesAgo: 30,
    history: [],
  },
  {
    title: "Weekly digest email had broken charts",
    summary:
      "The Monday digest rendered broken chart images for a subset of mail clients. Cosmetic, low impact.",
    severity: "SEV4",
    status: "RESOLVED",
    affectedService: "digest-emails",
    affectedRegion: null,
    symptoms: "Broken image placeholders in Outlook 2016 only",
    suggestedNextAction: "Fix CID image embedding for legacy mail clients",
    confidence: 0.83,
    reporterPhone: SEED_REPORTER,
    inboundBody:
      "minor thing - the weekly digest email shows broken chart images for some folks on outlook",
    minutesAgo: 60 * 26,
    history: [
      { newStatus: "IDENTIFIED", note: "Missing CID attachment in template", minutesAgo: 60 * 25 },
      { newStatus: "RESOLVED", note: "Template fix shipped", minutesAgo: 60 * 22 },
    ],
  },
];

async function seed() {
  const existing = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from incidents`,
  );
  if (Number(existing[0]?.count ?? 0) > 0) {
    console.log("Seed skipped: incidents table already has data.");
    await client.end();
    return;
  }

  for (const item of SEED) {
    const createdAt = new Date(Date.now() - item.minutesAgo * 60 * 1000);
    const seqRow = await db.execute<{ nextval: string }>(
      sql`select nextval('incident_number_seq') as nextval`,
    );
    const number = formatIncidentNumber(Number(seqRow[0]!.nextval));

    const inserted = await db
      .insert(incidents)
      .values({
        number,
        title: item.title,
        summary: item.summary,
        severity: item.severity,
        status: item.status,
        affectedService: item.affectedService,
        affectedRegion: item.affectedRegion,
        symptoms: item.symptoms,
        suggestedNextAction: item.suggestedNextAction,
        confidence: item.confidence,
        reporterPhone: item.reporterPhone,
        sourceMessageId: `seed-msg-${number.toLowerCase()}`,
        createdAt,
        updatedAt: item.history.at(-1)
          ? new Date(Date.now() - item.history.at(-1)!.minutesAgo * 60 * 1000)
          : createdAt,
        resolvedAt:
          item.status === "RESOLVED"
            ? new Date(Date.now() - (item.history.at(-1)?.minutesAgo ?? item.minutesAgo) * 60 * 1000)
            : null,
      })
      .returning();
    const incident = inserted[0]!;

    await db.insert(messageEvents).values({
      telnyxMessageId: `seed-msg-${number.toLowerCase()}`,
      idempotencyKey: `seed-evt-${number.toLowerCase()}`,
      incidentId: incident.id,
      direction: "inbound",
      eventType: "message.received",
      phone: item.reporterPhone,
      body: item.inboundBody,
      deliveryStatus: "received",
      raw: JSON.stringify({ seed: true }),
      createdAt,
      updatedAt: createdAt,
    });

    await db.insert(incidentUpdates).values({
      incidentId: incident.id,
      previousStatus: null,
      newStatus: "INVESTIGATING",
      operatorNote: `Opened from inbound report ${number}`,
      createdAt,
    });

    for (const entry of item.history) {
      const at = new Date(Date.now() - entry.minutesAgo * 60 * 1000);
      await db.insert(incidentUpdates).values({
        incidentId: incident.id,
        previousStatus: null,
        newStatus: entry.newStatus,
        operatorNote: entry.note,
        createdAt: at,
      });
    }

    await db
      .insert(subscribers)
      .values({ incidentId: incident.id, phone: item.reporterPhone, createdAt })
      .onConflictDoNothing();
  }

  // A resolved status update path needs the update rows to reflect transitions;
  // the seed inserts are simplified for demo purposes.
  console.log(`Seeded ${SEED.length} incidents.`);
  await client.end();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
