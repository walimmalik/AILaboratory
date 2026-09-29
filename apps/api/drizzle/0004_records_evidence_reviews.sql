ALTER TABLE "records" ADD COLUMN "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "reviews" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- History snapshots carry the same fields as the records they copy.
UPDATE "record_versions" SET "snapshot" = "snapshot" || '{"evidence": {}, "reviews": {}}'::jsonb WHERE "snapshot"->'evidence' IS NULL;
