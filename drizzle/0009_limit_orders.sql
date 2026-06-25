DO $$ BEGIN
  CREATE TYPE "limit_order_status" AS ENUM ('open', 'filled', 'canceled', 'expired', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "limit_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "owner" text NOT NULL,
  "market_id" text NOT NULL,
  "outcome_index" integer NOT NULL,
  "outcome_label" text NOT NULL,
  "side" text NOT NULL,
  "limit_price_bps" integer NOT NULL,
  "shares" numeric(24, 6) NOT NULL,
  "slippage_bps" integer DEFAULT 200 NOT NULL,
  "status" "limit_order_status" DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "filled_at" timestamp with time zone,
  "tx_hash" text,
  "last_error" text
);
CREATE INDEX IF NOT EXISTS "limit_orders_owner_status_idx" ON "limit_orders" ("owner", "status");
CREATE INDEX IF NOT EXISTS "limit_orders_market_status_idx" ON "limit_orders" ("market_id", "status");
