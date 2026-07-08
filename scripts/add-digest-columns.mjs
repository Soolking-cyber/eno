// Add the weekly-digest opt-in + unsubscribe-token columns to Profile.
// Prisma can't push these cleanly through the profile_auth_fk cross-schema FK, so
// apply the raw DDL directly (ADD COLUMN doesn't touch the FK). IDEMPOTENT — safe to
// re-run, and MUST be re-applied after any `prisma migrate reset` / db reset
// (this is the SQL mirror of the schema.prisma fields:
//   weeklyDigestOptIn Boolean @default(true)
//   unsubscribeToken  String  @unique @default(cuid())  ← Prisma supplies cuid on create;
//   the DB gets a gen_random_uuid() default purely as a backstop for any non-Prisma insert).
//
// Run:  set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/add-digest-columns.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

const stmts = [
  `alter table public."Profile" add column if not exists "weeklyDigestOptIn" boolean not null default true;`,
  // volatile default → existing rows each get a unique token at ADD COLUMN time
  `alter table public."Profile" add column if not exists "unsubscribeToken" text default gen_random_uuid()::text;`,
  `update public."Profile" set "unsubscribeToken" = gen_random_uuid()::text where "unsubscribeToken" is null;`,
  `alter table public."Profile" alter column "unsubscribeToken" set not null;`,
  `create unique index if not exists "Profile_unsubscribeToken_key" on public."Profile" ("unsubscribeToken");`,
]

for (const sql of stmts) {
  await client.query(sql)
  console.log('✓', sql.slice(0, 72))
}

await client.end()
console.log('done: weeklyDigestOptIn + unsubscribeToken on Profile')
