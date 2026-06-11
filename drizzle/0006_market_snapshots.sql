CREATE TABLE "market_snapshots" (
  "market_id" text NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "probabilities" jsonb NOT NULL,
  CONSTRAINT "market_snapshots_market_id_captured_at_pk" PRIMARY KEY("market_id","captured_at")
);
