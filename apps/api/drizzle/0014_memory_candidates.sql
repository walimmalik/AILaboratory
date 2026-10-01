CREATE TABLE "memory_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"detector" text NOT NULL,
	"key" text NOT NULL,
	"draft" jsonb NOT NULL,
	"source" text NOT NULL,
	"bar" jsonb NOT NULL,
	"observations" jsonb NOT NULL,
	"status" text NOT NULL,
	"memory" text,
	"proposed_with" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_candidates_key_idx" ON "memory_candidates" USING btree ("lab_id","detector","key");