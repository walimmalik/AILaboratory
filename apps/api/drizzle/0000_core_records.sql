CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "labs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "name_counters" (
	"lab_id" text NOT NULL,
	"prefix" text NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "name_counters_lab_id_prefix_pk" PRIMARY KEY("lab_id","prefix")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_links" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"relation" text NOT NULL,
	"lab_id" text NOT NULL,
	CONSTRAINT "record_links_from_id_to_id_relation_pk" PRIMARY KEY("from_id","to_id","relation")
);
--> statement-breakpoint
CREATE TABLE "record_versions" (
	"record_id" text NOT NULL,
	"version" integer NOT NULL,
	"operation" text NOT NULL,
	"actor" jsonb NOT NULL,
	"reason" text,
	"at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "record_versions_record_id_version_pk" PRIMARY KEY("record_id","version")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"org_id" text NOT NULL,
	"lab_id" text NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"attributes" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" jsonb NOT NULL,
	CONSTRAINT "records_lab_name_unique" UNIQUE("lab_id","name"),
	CONSTRAINT "records_status_check" CHECK ("records"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "records_version_check" CHECK ("records"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_counters" ADD CONSTRAINT "name_counters_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_from_id_records_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_to_id_records_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_links_to_idx" ON "record_links" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "records_lab_kind_idx" ON "records" USING btree ("lab_id","kind");