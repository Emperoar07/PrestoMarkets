CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "owner" text NOT NULL,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "event_types" jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "last_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_owner_idx" ON "webhook_subscriptions" ("owner");
