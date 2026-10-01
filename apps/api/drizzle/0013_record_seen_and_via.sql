CREATE TABLE "record_seen" (
	"user_id" text NOT NULL,
	"record_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"version" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "record_seen_user_id_record_id_pk" PRIMARY KEY("user_id","record_id")
);
--> statement-breakpoint
ALTER TABLE "record_versions" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "record_seen" ADD CONSTRAINT "record_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_seen" ADD CONSTRAINT "record_seen_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_seen" ADD CONSTRAINT "record_seen_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;