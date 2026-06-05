CREATE TABLE "cron_leases" (
  "key" text PRIMARY KEY NOT NULL,
  "owner" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
