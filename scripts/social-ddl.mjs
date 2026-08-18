// The social syndication log — the DDL Prisma does not manage.
//
// IDEMPOTENT — safe to re-run, and MUST be re-applied after anything that reconciles the schema.
//
// Run:  DIRECT_URL="$DIRECT_URL" node scripts/social-ddl.mjs
//   (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// ⛔ IT IS NOT A PRISMA MODEL, AND THAT IS DELIBERATE. This database already holds 67 tables
// against 52 Prisma models, and `prisma db push` would DROP every unmanaged one — so adding a model
// is the dangerous option here, not the safe-looking one. A raw table joins the same set as
// visa_applications, next_cache and the rate limiter, all of which live outside Prisma on purpose.
//
// WHAT THE TABLE IS FOR, and why the UNIQUE is the whole design:
//
//   UNIQUE (listing_id, channel) is the ONLY thing standing between a daily job and posting the
//   same listing to the same Page every morning forever. The selection query filters on it AND the
//   insert relies on it — belt and braces, because a SELECT-then-POST has a window: two runs that
//   overlap (a retry, a manual trigger beside the schedule) both read "not posted" and both post.
//   The constraint closes it in the database, where a race cannot argue.
//
//   ⚠️ THE ROW IS WRITTEN BEFORE THE POST, NOT AFTER. A social post is not idempotent — there is no
//   request key to deduplicate on — so the failure to prefer is "we recorded a post that did not
//   happen" (a listing is skipped, and nobody notices) over "we posted and failed to record it"
//   (the same listing goes out again tomorrow, and the day after). Claim first, then post.
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const SQL = `
create table if not exists social_posts (
  id           bigserial primary key,
  listing_id   text        not null,
  channel      text        not null,
  posted_at    timestamptz not null default now(),
  -- The platform's own id for the post, when it returns one. Nullable: Reddit's submit endpoint
  -- does not hand one back in a form worth parsing, and a missing id must not fail the write.
  external_id  text,
  -- 'posted' once the platform accepted it; 'failed' when the claim was made and the post threw.
  -- A failed row STAYS, so a channel that rejects a listing does not retry it every single day.
  status       text        not null default 'posted'
);
create unique index if not exists social_posts_listing_channel_uniq
  on social_posts (listing_id, channel);
-- The daily job asks "what went out recently" for its own log line; this keeps that cheap.
create index if not exists social_posts_posted_at_idx on social_posts (posted_at desc);
`

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('begin')
  await client.query(SQL)
  await client.query('commit')
  const { rows } = await client.query(
    `select count(*)::int as n, count(*) filter (where status = 'failed')::int as failed from social_posts`,
  )
  console.log(`social_posts ready — ${rows[0].n} rows (${rows[0].failed} failed)`)
} catch (e) {
  await client.query('rollback')
  console.error('DDL failed, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
