import {
  boolean,
  doublePrecision,
  index,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const severityEnum = pgEnum("incident_severity", [
  "SEV1",
  "SEV2",
  "SEV3",
  "SEV4",
]);

export const statusEnum = pgEnum("incident_status", [
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
]);

export const directionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

export const incidentNumberSeq = pgSequence("incident_number_seq", {
  startWith: 1,
  increment: 1,
  minValue: 1,
  cache: 1,
});

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    severity: severityEnum("severity").notNull(),
    status: statusEnum("status").notNull().default("INVESTIGATING"),
    affectedService: text("affected_service").notNull(),
    affectedRegion: text("affected_region"),
    symptoms: text("symptoms").notNull(),
    suggestedNextAction: text("suggested_next_action").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    reporterPhone: text("reporter_phone").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("incidents_status_idx").on(table.status),
    index("incidents_severity_idx").on(table.severity),
    index("incidents_created_at_idx").on(table.createdAt),
  ],
);

export const incidentUpdates = pgTable(
  "incident_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    previousStatus: statusEnum("previous_status"),
    newStatus: statusEnum("new_status").notNull(),
    operatorNote: text("operator_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("incident_updates_incident_idx").on(table.incidentId, table.createdAt),
  ],
);

export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    active: boolean("active").notNull().default(true),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subscribers_incident_phone_idx").on(
      table.incidentId,
      table.phone,
    ),
    index("subscribers_phone_idx").on(table.phone),
  ],
);

export const messageEvents = pgTable(
  "message_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telnyxMessageId: text("telnyx_message_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    incidentId: uuid("incident_id").references(() => incidents.id, {
      onDelete: "set null",
    }),
    direction: directionEnum("direction").notNull(),
    eventType: text("event_type").notNull(),
    phone: text("phone").notNull(),
    body: text("body").notNull(),
    deliveryStatus: text("delivery_status"),
    errorDetails: text("error_details"),
    raw: text("raw").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("message_events_telnyx_message_idx").on(table.telnyxMessageId),
    index("message_events_created_idx").on(table.createdAt),
    index("message_events_phone_idx").on(table.phone),
  ],
);

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
export type IncidentUpdate = typeof incidentUpdates.$inferSelect;
export type Subscriber = typeof subscribers.$inferSelect;
export type MessageEvent = typeof messageEvents.$inferSelect;
