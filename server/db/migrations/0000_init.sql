CREATE TYPE "public"."check_decision" AS ENUM('keep', 'remove');--> statement-breakpoint
CREATE TYPE "public"."remediation_status" AS ENUM('todo', 'done');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"session_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "check_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"data" jsonb NOT NULL,
	"label" text NOT NULL,
	"assignee_id" uuid,
	"assigned_by_id" uuid,
	"assigned_at" timestamp with time zone,
	"decision" "check_decision",
	"comment" text,
	"responded_by_id" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"template" text NOT NULL,
	"status" "session_status" DEFAULT 'draft' NOT NULL,
	"due_date" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "remediations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_item_id" uuid NOT NULL,
	"status" "remediation_status" DEFAULT 'todo' NOT NULL,
	"note" text,
	"handled_by_id" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_id" text NOT NULL,
	"display_name" text NOT NULL,
	"mail" text,
	"user_principal_name" text,
	"job_title" text,
	"department" text,
	"account_enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_session_id_control_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."control_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_items" ADD CONSTRAINT "check_items_session_id_control_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."control_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_items" ADD CONSTRAINT "check_items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_items" ADD CONSTRAINT "check_items_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_items" ADD CONSTRAINT "check_items_responded_by_id_users_id_fk" FOREIGN KEY ("responded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_sessions" ADD CONSTRAINT "control_sessions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediations" ADD CONSTRAINT "remediations_check_item_id_check_items_id_fk" FOREIGN KEY ("check_item_id") REFERENCES "public"."check_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediations" ADD CONSTRAINT "remediations_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_session_idx" ON "audit_log" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "check_items_session_idx" ON "check_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "check_items_assignee_idx" ON "check_items" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "control_sessions_status_idx" ON "control_sessions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "remediations_check_item_uq" ON "remediations" USING btree ("check_item_id");--> statement-breakpoint
CREATE INDEX "remediations_status_idx" ON "remediations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_entra_id_uq" ON "users" USING btree ("entra_id");--> statement-breakpoint
CREATE INDEX "users_display_name_idx" ON "users" USING btree ("display_name");