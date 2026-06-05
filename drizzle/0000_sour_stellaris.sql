CREATE TYPE "public"."alert_channel" AS ENUM('inapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."comment_kind" AS ENUM('comment', 'source_update');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_period" AS ENUM('all', '30d');--> statement-breakpoint
CREATE TABLE "alert_prefs" (
	"address" text NOT NULL,
	"market_id" text NOT NULL,
	"types" jsonb NOT NULL,
	"channel" "alert_channel" DEFAULT 'inapp' NOT NULL,
	CONSTRAINT "alert_prefs_address_market_id_pk" PRIMARY KEY("address","market_id")
);
--> statement-breakpoint
CREATE TABLE "comment_likes" (
	"address" text NOT NULL,
	"comment_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_likes_address_comment_id_pk" PRIMARY KEY("address","comment_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
	CONSTRAINT "leaderboard_cache_address_period_pk" PRIMARY KEY("address","period")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"address" text PRIMARY KEY NOT NULL,
	"handle" text,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"opt_in_leaderboard" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "siwe_nonces" (
	"address" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"address" text NOT NULL,
	"market_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_address_market_id_pk" PRIMARY KEY("address","market_id")
);
--> statement-breakpoint
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_unique" ON "profiles" USING btree ("handle");