CREATE TABLE IF NOT EXISTS "semantic_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diff" text NOT NULL,
	"model" text NOT NULL,
	"response" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "cache_status" text DEFAULT 'miss' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "prompt_cache_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semantic_cache_expires_at_idx" ON "semantic_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semantic_cache_embedding_hnsw_idx" ON "semantic_cache" USING hnsw ("embedding" vector_cosine_ops);