// One-off migration: create the comment_likes table (idempotent, additive only).
// Run with the UNPOOLED Neon connection string in MIGRATE_URL, e.g. (PowerShell):
//   $env:MIGRATE_URL="postgresql://...neon.tech/neondb?sslmode=require"; node apply-comment-likes.cjs
// The secret is read from the env var and never written to disk.
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
neonConfig.webSocketConstructor = ws;

const url = process.env.MIGRATE_URL;
if (!url) {
  console.error('Set MIGRATE_URL to your Neon connection string (UNPOOLED preferred).');
  process.exit(1);
}

const SQL = `
CREATE TABLE IF NOT EXISTS "comment_likes" (
  "address" text NOT NULL,
  "comment_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "comment_likes_address_comment_id_pk" PRIMARY KEY ("address","comment_id")
);
DO $$ BEGIN
  ALTER TABLE "comment_likes"
    ADD CONSTRAINT "comment_likes_comment_id_comments_id_fk"
    FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

(async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(SQL);
    const { rows } = await pool.query(
      "SELECT to_regclass('public.comment_likes') IS NOT NULL AS exists",
    );
    console.log('comment_likes exists:', rows[0].exists);
    console.log('Done. Comments should load again.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
