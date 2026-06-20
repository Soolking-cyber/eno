// Trigram GIN index on Listing.searchText so the keystroke search
// ({ searchText: { contains } } → ILIKE '%term%') uses a bitmap index scan
// instead of a sequential scan. Raw SQL because Prisma can't model GIN/trgm.
// Idempotent; re-run after any DB reset. Run over DIRECT_URL (not the pooler):
//   set -a; . ./.env; set +a; node scripts/search-index.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

// CREATE INDEX CONCURRENTLY can't run inside a transaction; pg runs each query
// in autocommit, so these are fine sequentially.
await client.query('create extension if not exists pg_trgm')
console.log('✓ pg_trgm extension')
await client.query(
  'create index concurrently if not exists listing_searchtext_trgm on "Listing" using gin ("searchText" gin_trgm_ops)',
)
console.log('✓ listing_searchtext_trgm GIN index')

const { rows } = await client.query(
  "select indexname from pg_indexes where tablename = 'Listing' and indexname = 'listing_searchtext_trgm'",
)
console.log(rows.length ? '\n✓ trigram search index in place.' : '\n✗ MISSING')
await client.end()
