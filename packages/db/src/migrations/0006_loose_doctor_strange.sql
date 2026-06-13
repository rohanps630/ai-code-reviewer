ALTER TABLE "reviews" ADD COLUMN "owner_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_owner_id_idx" ON "reviews" USING btree ("owner_id");