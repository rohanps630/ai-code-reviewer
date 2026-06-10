CREATE TABLE IF NOT EXISTS "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_events_review_seq_unique_idx" ON "agent_events" USING btree ("review_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_review_id_idx" ON "agent_events" USING btree ("review_id");--> statement-breakpoint
-- Backfills a missing index for semantic_cache (present in the schema/snapshot
-- but never migrated). IF NOT EXISTS keeps it safe on DBs that already have it.
CREATE INDEX IF NOT EXISTS "semantic_cache_model_expires_idx" ON "semantic_cache" USING btree ("model","expires_at");