CREATE TABLE "market_metadata_overrides" (
	"market_id" text PRIMARY KEY NOT NULL,
	"image_uri" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
