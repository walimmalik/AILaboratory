ALTER TABLE "inventory_events" ADD COLUMN "run_log" text;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_events_run_log_idx" ON "inventory_events" USING btree ("lab_id","run_log");