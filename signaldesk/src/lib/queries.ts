import "server-only";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { incidents, messageEvents, subscribers } from "@/db/schema";
import type { Severity } from "@/lib/severity";
import type { Status } from "@/lib/status";

export interface DashboardFilters {
  status?: Status;
  severity?: Severity;
}

export async function getIncidentCounts() {
  const rows = await db
    .select({ severity: incidents.severity, status: incidents.status, value: count() })
    .from(incidents)
    .groupBy(incidents.severity, incidents.status);

  const bySeverity: Record<Severity, number> = {
    SEV1: 0,
    SEV2: 0,
    SEV3: 0,
    SEV4: 0,
  };
  const byStatus: Record<Status, number> = {
    INVESTIGATING: 0,
    IDENTIFIED: 0,
    MONITORING: 0,
    RESOLVED: 0,
  };
  for (const row of rows) {
    bySeverity[row.severity] = Number(row.value);
    byStatus[row.status] = Number(row.value);
  }
  return { bySeverity, byStatus, total: rows.reduce((acc, r) => acc + Number(r.value), 0) };
}

export async function listIncidents(filters: DashboardFilters, limit = 25) {
  const conditions = [];
  if (filters.status) conditions.push(eq(incidents.status, filters.status));
  if (filters.severity) conditions.push(eq(incidents.severity, filters.severity));

  const query = db
    .select()
    .from(incidents)
    .orderBy(desc(incidents.createdAt))
    .limit(limit);

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function listActiveIncidents(limit = 25) {
  const rows = await db
    .select()
    .from(incidents)
    .where(sql`${incidents.status} <> 'RESOLVED'`)
    .orderBy(desc(incidents.createdAt))
    .limit(limit);
  return rows;
}

export async function listRecentInboundMessages(limit = 10) {
  return db
    .select({
      id: messageEvents.id,
      phone: messageEvents.phone,
      body: messageEvents.body,
      createdAt: messageEvents.createdAt,
      incidentId: messageEvents.incidentId,
      eventType: messageEvents.eventType,
    })
    .from(messageEvents)
    .where(eq(messageEvents.direction, "inbound"))
    .orderBy(desc(messageEvents.createdAt))
    .limit(limit);
}

/** Counts of outbound messages that reached a terminal failure state. */
export async function countDeliveryFailures() {
  const rows = await db
    .select({ value: count() })
    .from(messageEvents)
    .where(and(eq(messageEvents.direction, "outbound"), eq(messageEvents.deliveryStatus, "failed")));
  return Number(rows[0]?.value ?? 0);
}

export async function listOutboundFailures(limit = 10) {
  return db
    .select({
      id: messageEvents.id,
      phone: messageEvents.phone,
      body: messageEvents.body,
      errorDetails: messageEvents.errorDetails,
      eventType: messageEvents.eventType,
      createdAt: messageEvents.createdAt,
      incidentId: messageEvents.incidentId,
    })
    .from(messageEvents)
    .where(and(eq(messageEvents.direction, "outbound"), eq(messageEvents.deliveryStatus, "failed")))
    .orderBy(desc(messageEvents.createdAt))
    .limit(limit);
}

export async function getIncidentSubscriberCount(incidentId: string) {
  const rows = await db
    .select({ value: count() })
    .from(subscribers)
    .where(and(eq(subscribers.incidentId, incidentId), eq(subscribers.active, true)));
  return Number(rows[0]?.value ?? 0);
}

export async function listIncidentMessages(incidentId: string, limit = 30) {
  return db
    .select()
    .from(messageEvents)
    .where(eq(messageEvents.incidentId, incidentId))
    .orderBy(desc(messageEvents.createdAt))
    .limit(limit);
}

/** Recent outbound delivery summary for the incident page. */
export async function listOutboundDeliveryState(incidentId: string) {
  const rows = await db
    .select({
      phone: messageEvents.phone,
      deliveryStatus: messageEvents.deliveryStatus,
      eventType: messageEvents.eventType,
      createdAt: messageEvents.createdAt,
      telnyxMessageId: messageEvents.telnyxMessageId,
    })
    .from(messageEvents)
    .where(
      and(
        eq(messageEvents.incidentId, incidentId),
        eq(messageEvents.direction, "outbound"),
      ),
    )
    .orderBy(desc(messageEvents.createdAt));
  return rows;
}

/** The original inbound report that opened the incident, if recorded. */
export async function getIncidentSourceMessage(incidentId: string) {
  const rows = await db
    .select({ body: messageEvents.body, createdAt: messageEvents.createdAt })
    .from(messageEvents)
    .where(
      and(
        eq(messageEvents.incidentId, incidentId),
        eq(messageEvents.direction, "inbound"),
        eq(messageEvents.eventType, "message.received"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function countOutbox(limit = 50) {
  const rows = await db
    .select()
    .from(messageEvents)
    .where(eq(messageEvents.direction, "outbound"))
    .orderBy(desc(messageEvents.createdAt))
    .limit(limit);
  return rows;
}

export async function countMessagesSince(hours: number) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select({ value: count() })
    .from(messageEvents)
    .where(gte(messageEvents.createdAt, since));
  return Number(rows[0]?.value ?? 0);
}
