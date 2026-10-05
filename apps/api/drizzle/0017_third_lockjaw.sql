CREATE TABLE "library_snapshots" (
	"document_id" text NOT NULL,
	"file_id" text NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"snapshot" text NOT NULL,
	"sha256" text NOT NULL,
	"content" jsonb NOT NULL,
	"converter" text NOT NULL,
	"warnings" jsonb NOT NULL,
	"parsed_at" timestamp with time zone NOT NULL,
	"parsed_by" jsonb NOT NULL,
	CONSTRAINT "library_snapshots_lab_id_document_id_file_id_snapshot_pk" PRIMARY KEY("lab_id","document_id","file_id","snapshot")
);
--> statement-breakpoint
ALTER TABLE "library_parses" ADD COLUMN "snapshot" text;--> statement-breakpoint
ALTER TABLE "library_snapshots" ADD CONSTRAINT "library_snapshots_document_id_records_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_snapshots" ADD CONSTRAINT "library_snapshots_file_id_records_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_snapshots" ADD CONSTRAINT "library_snapshots_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_snapshots" ADD CONSTRAINT "library_snapshots_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;