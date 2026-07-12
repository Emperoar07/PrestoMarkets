CREATE TABLE IF NOT EXISTS "rate_limits" (
  "bucket" text PRIMARY KEY NOT NULL,
  "window_start" timestamp with time zone DEFAULT now() NOT NULL,
  "count" integer DEFAULT 1 NOT NULL
);
