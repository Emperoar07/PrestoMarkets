-- Durable ledger of markets the agent created, written synchronously at creation time.
-- Cross-run duplicate detection reads this instead of trusting the market-list snapshot,
-- which ingests new markets via best-effort background work and can lag under RPC
-- saturation — the lag window is exactly how identical fixture markets got created twice.
CREATE TABLE IF NOT EXISTS "agent_creations" (
  "market_id" text PRIMARY KEY,
  "title" text NOT NULL,
  "trend_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "agent_creations_created_at_idx" ON "agent_creations" ("created_at");
