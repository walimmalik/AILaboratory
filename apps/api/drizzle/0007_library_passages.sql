CREATE TABLE "library_parses" (
	"document_id" text NOT NULL,
	"file_id" text NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"sha256" text NOT NULL,
	"converter" text NOT NULL,
	"sections" integer NOT NULL,
	"passages" integer NOT NULL,
	"warnings" jsonb NOT NULL,
	"parsed_at" timestamp with time zone NOT NULL,
	"parsed_by" jsonb NOT NULL,
	CONSTRAINT "library_parses_document_id_file_id_pk" PRIMARY KEY("document_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "library_passages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"document_id" text NOT NULL,
	"file_id" text NOT NULL,
	"section" integer NOT NULL,
	"heading" jsonb NOT NULL,
	"section_page_from" integer,
	"section_page_to" integer,
	"seq" integer NOT NULL,
	"page" integer,
	"text" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading_text, '') || ' ' || text)) STORED NOT NULL,
	"heading_text" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_parses" ADD CONSTRAINT "library_parses_document_id_records_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_parses" ADD CONSTRAINT "library_parses_file_id_records_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_parses" ADD CONSTRAINT "library_parses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_parses" ADD CONSTRAINT "library_parses_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_passages" ADD CONSTRAINT "library_passages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_passages" ADD CONSTRAINT "library_passages_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_passages" ADD CONSTRAINT "library_passages_document_id_records_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_passages" ADD CONSTRAINT "library_passages_file_id_records_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_passages_document_idx" ON "library_passages" USING btree ("document_id","file_id","section","seq");--> statement-breakpoint
CREATE INDEX "library_passages_search_idx" ON "library_passages" USING gin ("search");