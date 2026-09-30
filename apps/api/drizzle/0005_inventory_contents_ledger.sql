CREATE TABLE "inventory_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"type" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" jsonb NOT NULL,
	"operation_id" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "inventory_lines" (
	"event_id" text NOT NULL,
	"seq" integer NOT NULL,
	"container_id" text NOT NULL,
	"well" text NOT NULL,
	"change" text NOT NULL,
	"volume" jsonb,
	"from" jsonb,
	"to" jsonb,
	"after" jsonb NOT NULL,
	CONSTRAINT "inventory_lines_event_id_seq_pk" PRIMARY KEY("event_id","seq"),
	CONSTRAINT "inventory_lines_change_check" CHECK ("inventory_lines"."change" in ('in', 'out', 'set'))
);
--> statement-breakpoint
CREATE TABLE "well_contents" (
	"container_id" text NOT NULL,
	"well" text NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"state" jsonb NOT NULL,
	"last_event_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "well_contents_container_id_well_pk" PRIMARY KEY("container_id","well")
);
--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_event_id_inventory_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_container_id_records_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "well_contents" ADD CONSTRAINT "well_contents_container_id_records_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "well_contents" ADD CONSTRAINT "well_contents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "well_contents" ADD CONSTRAINT "well_contents_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_events_lab_at_idx" ON "inventory_events" USING btree ("lab_id","at");--> statement-breakpoint
CREATE INDEX "inventory_lines_well_idx" ON "inventory_lines" USING btree ("container_id","well");