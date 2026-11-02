ALTER TYPE "public"."remediation_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "check_items" ADD COLUMN "closed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "check_items" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "check_items" ADD CONSTRAINT "check_items_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;