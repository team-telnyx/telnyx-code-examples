CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('SEV1', 'SEV2', 'SEV3', 'SEV4');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');--> statement-breakpoint
CREATE SEQUENCE "public"."incident_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"previous_status" "incident_status",
	"new_status" "incident_status" NOT NULL,
	"operator_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"status" "incident_status" DEFAULT 'INVESTIGATING' NOT NULL,
	"affected_service" text NOT NULL,
	"affected_region" text,
	"symptoms" text NOT NULL,
	"suggested_next_action" text NOT NULL,
	"confidence" double precision NOT NULL,
	"reporter_phone" text NOT NULL,
	"source_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "incidents_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telnyx_message_id" text,
	"idempotency_key" text NOT NULL,
	"incident_id" uuid,
	"direction" "message_direction" NOT NULL,
	"event_type" text NOT NULL,
	"phone" text NOT NULL,
	"body" text NOT NULL,
	"delivery_status" text,
	"error_details" text,
	"raw" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"opted_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_updates_incident_idx" ON "incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_severity_idx" ON "incidents" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "incidents_created_at_idx" ON "incidents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_events_telnyx_message_idx" ON "message_events" USING btree ("telnyx_message_id");--> statement-breakpoint
CREATE INDEX "message_events_created_idx" ON "message_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_events_phone_idx" ON "message_events" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_incident_phone_idx" ON "subscribers" USING btree ("incident_id","phone");--> statement-breakpoint
CREATE INDEX "subscribers_phone_idx" ON "subscribers" USING btree ("phone");