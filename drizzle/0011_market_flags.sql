CREATE TABLE IF NOT EXISTS "market_flags" (
  "market_id" text PRIMARY KEY NOT NULL,
  "flag" text NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
