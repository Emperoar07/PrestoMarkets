CREATE TABLE IF NOT EXISTS "circle_gateway_events" (
  "notification_id" text PRIMARY KEY NOT NULL,
  "subscription_id" text,
  "notification_type" text NOT NULL,
  "event_type" text NOT NULL,
  "tx_hash" text,
  "wallet_address" text,
  "payload" jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "circle_gateway_events_type_idx" ON "circle_gateway_events" ("event_type");
CREATE INDEX IF NOT EXISTS "circle_gateway_events_wallet_idx" ON "circle_gateway_events" ("wallet_address");
