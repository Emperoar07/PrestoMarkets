CREATE TYPE "comment_kind" AS ENUM ('comment', 'source_update');
CREATE TYPE "alert_channel" AS ENUM ('inapp', 'email');
CREATE TYPE "leaderboard_period" AS ENUM ('all', '30d');

CREATE TABLE "profiles" (
  "address" text PRIMARY KEY NOT NULL,
  "handle" text,
  "bio" text DEFAULT '' NOT NULL,
  "avatar_url" text DEFAULT '' NOT NULL,
  "opt_in_leaderboard" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "profiles_handle_unique" ON "profiles" ("handle");

CREATE TABLE "comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "market_id" text NOT NULL,
  "author_address" text NOT NULL,
  "parent_id" integer,
  "body" text NOT NULL,
  "kind" "comment_kind" DEFAULT 'comment' NOT NULL,
  "hidden" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "edited_at" timestamp with time zone
);

CREATE TABLE "watchlist" (
  "address" text NOT NULL,
  "market_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("address", "market_id")
);

CREATE TABLE "alert_prefs" (
  "address" text NOT NULL,
  "market_id" text NOT NULL,
  "types" jsonb NOT NULL,
  "channel" "alert_channel" DEFAULT 'inapp' NOT NULL,
  PRIMARY KEY ("address", "market_id")
);

CREATE TABLE "leaderboard_cache" (
  "address" text NOT NULL,
  "period" "leaderboard_period" NOT NULL,
  "realized_pnl" numeric(18, 6) DEFAULT '0' NOT NULL,
  "markets_traded" integer DEFAULT 0 NOT NULL,
  "resolved_correct" integer DEFAULT 0 NOT NULL,
  "brier" numeric(12, 6) DEFAULT '0' NOT NULL,
  "accuracy" numeric(12, 6) DEFAULT '0' NOT NULL,
  "created_count" integer DEFAULT 0 NOT NULL,
  "rank" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("address", "period")
);
