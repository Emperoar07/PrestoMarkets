CREATE TABLE IF NOT EXISTS "market_list_cache" (
  "key" text PRIMARY KEY NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
