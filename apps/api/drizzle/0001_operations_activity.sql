CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" jsonb NOT NULL,
	"operation_id" text NOT NULL,
	"outcome" text NOT NULL,
	"record_ids" jsonb NOT NULL,
	"proposal_id" text,
	"input" jsonb NOT NULL,
	"error" jsonb,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"preview" jsonb,
	"status" text NOT NULL,
	"proposed_by" jsonb NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"reason" text,
	"decided_by" jsonb,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"error" jsonb,
	CONSTRAINT "proposals_status_check" CHECK ("proposals"."status" in ('pending', 'approved', 'rejected', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_lab_at_idx" ON "activity" USING btree ("lab_id","at");--> statement-breakpoint
CREATE INDEX "proposals_lab_status_idx" ON "proposals" USING btree ("lab_id","status","proposed_at");