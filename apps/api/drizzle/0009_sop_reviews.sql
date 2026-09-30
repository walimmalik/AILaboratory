CREATE TABLE "sop_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"sop_id" text NOT NULL,
	"round" integer NOT NULL,
	"model" text NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer,
	"findings" jsonb NOT NULL,
	"refused" jsonb NOT NULL,
	"summary" text,
	"by" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sop_reviews" ADD CONSTRAINT "sop_reviews_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_reviews" ADD CONSTRAINT "sop_reviews_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_reviews" ADD CONSTRAINT "sop_reviews_sop_id_records_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sop_reviews_sop_idx" ON "sop_reviews" USING btree ("lab_id","sop_id");