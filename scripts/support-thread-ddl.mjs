// Support-thread DDL — lets a Conversation exist WITHOUT a listing, so "message support" is a real
// thread in /messages rather than a form. Idempotent; re-run any time.
//
//   set -a; . ./.env; set +a; node scripts/support-thread-ddl.mjs
//
// ⛔ WIDENING ONLY. The single schema change is `ALTER COLUMN "listingId" DROP NOT NULL`, which
// admits values the column previously rejected and invalidates no existing row — every conversation
// that exists today still has its listing. Nothing is dropped, nothing is rewritten. That is why
// this is a hand-written statement in the repo's own DDL idiom rather than a `prisma migrate`
// round-trip, and why it is safe to run against production: see the schema-change section of
// CLAUDE.md for why `prisma db push` is banned here (it would generate 18 DROP TABLEs).
//
// ⚠️ THE PARTIAL UNIQUE INDEX IS THE POINT, NOT AN EXTRA. `@@unique([listingId, buyerProfileId])`
// stops being a constraint the moment listingId is NULL, because Postgres treats NULLs as DISTINCT
// — so without this, one person could open an unbounded number of support threads simply by
// tapping the button repeatedly. `WHERE "listingId" IS NULL` scopes it to exactly the support rows
// and leaves every listing thread governed by the original constraint.

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const statements = [
  `alter table "Conversation" alter column "listingId" drop not null`,
  // ⛔ KEYED ON (buyerProfileId, sellerId), NOT buyerProfileId ALONE — AND THAT IS A LICENSING
  // CONTROL, not a uniqueness nicety. eno.vn and eno.forum share ONE database. Keyed on the buyer
  // only, a person would have ONE support thread across both sites, so a support conversation begun
  // on eno.forum — where visa, itinerary and PayPal are legitimate subjects — would appear in the
  // licensed marketplace's inbox. Each edition has its own support seller (below), so this gives
  // each person one thread PER EDITION and the two can never merge. A reviewer caught it.
  `drop index if exists "Conversation_support_thread_key"`,
  `create unique index if not exists "Conversation_support_thread_key"
     on "Conversation" ("buyerProfileId", "sellerId") where "listingId" is null`,
]

const client = new pg.Client({ connectionString: url })
await client.connect()

// ⚠️ Report the BEFORE state, because "drop not null" on an already-nullable column succeeds
// silently and a re-run would otherwise look identical to the first one.
const before = await client.query(
  `select is_nullable from information_schema.columns
   where table_name = 'Conversation' and column_name = 'listingId'`,
)
console.log(`listingId nullable before: ${before.rows[0]?.is_nullable ?? '(column not found)'}`)

for (const s of statements) {
  await client.query(s)
  console.log('ok  ' + s.trim().split('\n')[0].slice(0, 76))
}

const after = await client.query(
  `select is_nullable from information_schema.columns
   where table_name = 'Conversation' and column_name = 'listingId'`,
)
const idx = await client.query(
  `select indexdef from pg_indexes where indexname = 'Conversation_support_thread_key'`,
)
console.log(`listingId nullable after : ${after.rows[0]?.is_nullable}`)
console.log(`partial index            : ${idx.rows[0]?.indexdef ? 'present' : 'MISSING'}`)

// ⚠️ A conversation also needs a Seller (`sellerId` is NOT NULL), so support gets one row of its
// own. UNOWNED on purpose — `ownerId` stays null, which keeps it out of the footer's seller count
// (that counts owned storefronts) and out of every browse surface, since it has no listings.
const seller = await client.query(
  // Only id and name are NOT NULL without a default (checked against information_schema); every
  // other column has one, so this stays a two-column insert that cannot rot as the model grows.
  // ONE PER EDITION — see the index above for why they must not be shared.
  `insert into "Seller" (id, name)
   values ('eno-support-desk', 'eno Support'), ('eno-support-desk-forum', 'eno Support')
   on conflict (id) do nothing
   returning id`,
)
console.log(`support sellers          : ${seller.rowCount} created (2 expected on a first run)`)

await client.end()
console.log('\nsupport-thread DDL applied')
