CREATE TYPE "notification_type" AS ENUM('comment_reply', 'comment_like', 'market_resolved', 'market_canceled', 'system');
--> statement-breakpoint
CREATE TABLE "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "address" text NOT NULL,
  "type" "notification_type" NOT NULL,
  "title" text NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "market_id" text,
  "link" text,
  "read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email" text;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email_notifications" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX "notifications_address_read_created" ON "notifications" ("address", "read", "created_at");
