ALTER TABLE "memory_candidates" ADD COLUMN "quiet_limit" integer;--> statement-breakpoint
CREATE INDEX "memory_candidates_memory_idx" ON "memory_candidates" USING btree ("lab_id","memory");