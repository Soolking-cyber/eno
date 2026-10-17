// The pg_trgm extension the keystroke search's trigram index needs ({ searchText: { contains } } → LIKE '%term%').
// The index itself moved to scripts/listing-index-diet-ddl.mjs (partial, live rows only — see below).
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
// ⛔ NO INDEX HERE ANY MORE (speed plan item 9, 2026-10-17). A FULL trigram GIN was 148 MB for 1.5% of rows any public
// search can match; the search index is now the partial Listing_live_searchText_trgm_idx (WHERE verified AND status =
// 'active'), built by scripts/listing-index-diet-ddl.mjs --phase=create. Creating a full one here would undo that.
console.log('  the search index: node scripts/listing-index-diet-ddl.mjs --phase=create')
await client.end()
