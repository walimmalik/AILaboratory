CREATE TABLE "library_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"document_id" text NOT NULL,
	"file_id" text NOT NULL,
	"passage_id" text NOT NULL,
	"section" integer NOT NULL,
	"heading" jsonb NOT NULL,
	"page" integer,
	"text" text NOT NULL,
	"type" text NOT NULL,
	"record_id" text,
	"assay" text,
	"parameter" text,
	"value" jsonb,
	"how" text NOT NULL,
	"status" text NOT NULL,
	"proposed_by" jsonb NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"reviewed_by" jsonb,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "library_mentions_type_check" CHECK ("library_mentions"."type" in ('record', 'assay', 'parameter')),
	CONSTRAINT "library_mentions_status_check" CHECK ("library_mentions"."status" in ('proposed', 'confirmed', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "library_mentions" ADD CONSTRAINT "library_mentions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_mentions" ADD CONSTRAINT "library_mentions_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_mentions" ADD CONSTRAINT "library_mentions_document_id_records_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_mentions" ADD CONSTRAINT "library_mentions_file_id_records_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_mentions" ADD CONSTRAINT "library_mentions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_mentions_document_idx" ON "library_mentions" USING btree ("lab_id","document_id");--> statement-breakpoint
CREATE INDEX "library_mentions_record_idx" ON "library_mentions" USING btree ("record_id");