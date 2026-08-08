CREATE TABLE `agent_creations` (
	`market_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`trend_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_creations_created_at_idx` ON `agent_creations` (`created_at`);--> statement-breakpoint
CREATE TABLE `alert_prefs` (
	`address` text NOT NULL,
	`market_id` text NOT NULL,
	`types` text NOT NULL,
	`channel` text DEFAULT 'inapp' NOT NULL,
	PRIMARY KEY(`address`, `market_id`)
);
--> statement-breakpoint
CREATE TABLE `circle_gateway_events` (
	`notification_id` text PRIMARY KEY NOT NULL,
	`subscription_id` text,
	`notification_type` text NOT NULL,
	`event_type` text NOT NULL,
	`tx_hash` text,
	`wallet_address` text,
	`payload` text NOT NULL,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `circle_gateway_events_type_idx` ON `circle_gateway_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `circle_gateway_events_wallet_idx` ON `circle_gateway_events` (`wallet_address`);--> statement-breakpoint
CREATE TABLE `comment_likes` (
	`address` text NOT NULL,
	`comment_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`address`, `comment_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`market_id` text NOT NULL,
	`author_address` text NOT NULL,
	`parent_id` integer,
	`body` text NOT NULL,
	`kind` text DEFAULT 'comment' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`edited_at` integer
);
--> statement-breakpoint
CREATE TABLE `cron_leases` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leaderboard_cache` (
	`address` text NOT NULL,
	`period` text NOT NULL,
	`realized_pnl` text DEFAULT '0' NOT NULL,
	`markets_traded` integer DEFAULT 0 NOT NULL,
	`resolved_correct` integer DEFAULT 0 NOT NULL,
	`brier` text DEFAULT '0' NOT NULL,
	`accuracy` text DEFAULT '0' NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`rank` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`address`, `period`)
);
--> statement-breakpoint
CREATE TABLE `limit_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`market_id` text NOT NULL,
	`outcome_index` integer NOT NULL,
	`outcome_label` text NOT NULL,
	`side` text NOT NULL,
	`limit_price_bps` integer NOT NULL,
	`shares` text NOT NULL,
	`slippage_bps` integer DEFAULT 200 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer,
	`filled_at` integer,
	`tx_hash` text,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `limit_orders_owner_status_idx` ON `limit_orders` (`owner`,`status`);--> statement-breakpoint
CREATE INDEX `limit_orders_market_status_idx` ON `limit_orders` (`market_id`,`status`);--> statement-breakpoint
CREATE TABLE `market_flags` (
	`market_id` text PRIMARY KEY NOT NULL,
	`flag` text NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_list_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_metadata_overrides` (
	`market_id` text PRIMARY KEY NOT NULL,
	`image_uri` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_snapshots` (
	`market_id` text NOT NULL,
	`captured_at` integer DEFAULT (unixepoch()) NOT NULL,
	`probabilities` text NOT NULL,
	PRIMARY KEY(`market_id`, `captured_at`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`market_id` text,
	`link` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_address_read_created` ON `notifications` (`address`,`read`,`created_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`address` text PRIMARY KEY NOT NULL,
	`handle` text,
	`bio` text DEFAULT '' NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`opt_in_leaderboard` integer DEFAULT false NOT NULL,
	`email` text,
	`email_notifications` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_handle_unique` ON `profiles` (`handle`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `siwe_nonces` (
	`address` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`address` text NOT NULL,
	`market_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`address`, `market_id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`event_types` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_status` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_subscriptions_owner_idx` ON `webhook_subscriptions` (`owner`);