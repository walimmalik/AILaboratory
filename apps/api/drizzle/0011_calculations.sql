CREATE TABLE "calculations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calculations_lab_idx" ON "calculations" USING btree ("lab_id","created_at");