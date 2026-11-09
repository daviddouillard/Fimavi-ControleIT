CREATE TYPE "public"."collection_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('sent', 'failed');--> statement-breakpoint
ALTER TYPE "public"."check_decision" ADD VALUE 'reassign';--> statement-breakpoint
CREATE TABLE "collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"status" "collection_status" DEFAULT 'running' NOT NULL,
	"started_by_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "internal_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"sent_by_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pending_count" integer NOT NULL,
	"status" "notification_status" NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sharepoint_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"url" text NOT NULL,
	"display_name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "users_entra_id_uq";--> statement-breakpoint
ALTER TABLE "check_items" ADD COLUMN "dedup_key" text;--> statement-breakpoint
ALTER TABLE "control_sessions" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Comptes existants : tenant vide, rattachés au tenant principal par l'application (claimLegacyUsers).
ALTER TABLE "users" ADD COLUMN "tenant_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_session_id_control_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."control_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_session_id_control_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."control_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharepoint_sites" ADD CONSTRAINT "sharepoint_sites_connection_id_tenant_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tenant_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_runs_session_idx" ON "collection_runs" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_runs_one_running_uq" ON "collection_runs" USING btree ("session_id") WHERE "collection_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "notifications_session_idx" ON "notifications" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sharepoint_sites_url_uq" ON "sharepoint_sites" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_connections_tenant_uq" ON "tenant_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "check_items_session_dedup_uq" ON "check_items" USING btree ("session_id","dedup_key");--> statement-breakpoint
CREATE UNIQUE INDEX "check_items_session_row_uq" ON "check_items" USING btree ("session_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_entra_id_uq" ON "users" USING btree ("tenant_id","entra_id");