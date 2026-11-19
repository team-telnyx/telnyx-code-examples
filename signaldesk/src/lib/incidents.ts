import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  incidentUpdates,
  incidents,
  messageEvents,
  subscribers,
  type Incident,
} from "@/db/schema";
import { formatIncidentNumber } from "@/lib/incident-number";
import type { Severity } from "@/lib/severity";
import type { Status } from "@/lib/status";
import { isTransitionValid, STATUSES } from "@/lib/status";

export interface CreateIncidentInput {
  title: string;
  summary: string;
  severity: Severity;
  affectedService: string;
  affectedRegion: string | null;
  symptoms: string;
  suggestedNextAction: string;
  confidence: number;
  reporterPhone: string;
  sourceMessageId: string;
}

export interface CreateIncidentResult {
  incident: Incident;
}

/**
 * Creates an incident, its initial IncidentUpdate, and the reporter's
 * Subscriber row in a single transaction, linking the already-recorded
 * inbound MessageEvent. Concurrency-safe: the incident number comes from a
 * PostgreSQL sequence, and the inbound event was deduplicated by the caller.
 */
export async function createIncidentLinkedToMessage(
  messageEventId: string,
  input: CreateIncidentInput,
): Promise<CreateIncidentResult> {
  return db.transaction(async (tx) => {
    const seqResult = await tx.execute<{ nextval: string }>(
      sql`select nextval('incident_number_seq') as nextval`,
    );
    const seqValue = Number(seqResult[0]?.nextval ?? 0);
    const number = formatIncidentNumber(seqValue);

    const insertedIncidents = await tx
      .insert(incidents)
      .values({
        number,
        title: input.title,
        summary: input.summary,
        severity: input.severity,
        status: "INVESTIGATING",
        affectedService: input.affectedService,
        affectedRegion: input.affectedRegion,
        symptoms: input.symptoms,
        suggestedNextAction: input.suggestedNextAction,
        confidence: input.confidence,
        reporterPhone: input.reporterPhone,
        sourceMessageId: input.sourceMessageId,
      })
      .returning();

    const incident = insertedIncidents[0]!;

    await tx
      .update(messageEvents)
      .set({ incidentId: incident.id, updatedAt: new Date() })
      .where(eq(messageEvents.id, messageEventId));

    await tx.insert(incidentUpdates).values({
      incidentId: incident.id,
      previousStatus: null,
      newStatus: "INVESTIGATING",
      operatorNote: `Opened from inbound report ${number}`,
    });

    await tx
      .insert(subscribers)
      .values({ incidentId: incident.id, phone: input.reporterPhone })
      .onConflictDoNothing({
        target: [subscribers.incidentId, subscribers.phone],
      });

    return { incident };
  });
}

export function safeJsonString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}

export async function findIncidentByNumber(
  number: string,
): Promise<Incident | undefined> {
  const rows = await db
    .select()
    .from(incidents)
    .where(eq(incidents.number, number.toUpperCase()))
    .limit(1);
  return rows[0];
}

export async function getIncidentById(id: string): Promise<Incident | undefined> {
  const rows = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
  return rows[0];
}

/**
 * Applies a status transition. Validates the transition, records the update,
 * bumps timestamps, and clears resolved_at if the incident reopens.
 */
export async function applyStatusChange(
  incidentId: string,
  nextStatus: Status,
  operatorNote: string | null,
): Promise<Incident | undefined> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .for("update")
      .limit(1);
    const incident = rows[0];
    if (!incident) return undefined;

    if (!STATUSES.includes(nextStatus)) {
      throw new Error(`Unknown status: ${nextStatus}`);
    }
    if (!isTransitionValid(incident.status, nextStatus)) {
      throw new Error(
        `Invalid transition ${incident.status} → ${nextStatus}`,
      );
    }

    const now = new Date();
    const updatedRows = await tx
      .update(incidents)
      .set({
        status: nextStatus,
        resolvedAt: nextStatus === "RESOLVED" ? now : null,
        updatedAt: now,
      })
      .where(eq(incidents.id, incidentId))
      .returning();

    await tx.insert(incidentUpdates).values({
      incidentId,
      previousStatus: incident.status,
      newStatus: nextStatus,
      operatorNote,
    });

    return updatedRows[0];
  });
}

export async function listIncidentUpdates(incidentId: string) {
  return db
    .select()
    .from(incidentUpdates)
    .where(eq(incidentUpdates.incidentId, incidentId))
    .orderBy(desc(incidentUpdates.createdAt));
}

export async function isPhoneOptedOut(phone: string): Promise<boolean> {
  const rows = await db
    .select({ id: subscribers.id })
    .from(subscribers)
    .where(and(eq(subscribers.phone, phone), sql`${subscribers.optedOutAt} is not null`))
    .limit(1);
  return rows.length > 0;
}

/**
 * Marks every subscriber row for the given phone as opted out. Global
 * opt-out: no further operational SMS reaches this number.
 */
export async function optOutPhone(phone: string): Promise<number> {
  const updated = await db
    .update(subscribers)
    .set({ active: false, optedOutAt: new Date() })
    .where(and(eq(subscribers.phone, phone), sql`${subscribers.optedOutAt} is null`))
    .returning({ id: subscribers.id });
  return updated.length;
}

/** Restores messaging consent for the number (all incidents). */
export async function optInPhone(phone: string): Promise<number> {
  const updated = await db
    .update(subscribers)
    .set({ active: true, optedOutAt: null })
    .where(and(eq(subscribers.phone, phone), sql`${subscribers.optedOutAt} is not null`))
    .returning({ id: subscribers.id });
  return updated.length;
}
