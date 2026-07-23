// Purge the ISR-baked LISTING pages via the cache-handler's OWN tombstone mechanism.
//
// WHY: the PDP is ISR (revalidate=30d) and the cache survives deploys BY DESIGN
// (shared Postgres L2 + per-instance L1). A LAYOUT change therefore keeps serving
// old markup for up to 30 days. ⚠️ Deleting next_cache rows does NOT work — the
// running instances' in-process L1 keeps serving (proven live 2026-07-23). The only
// correct purge is a TOMBSTONE: cache-handler.cjs compares every entry's
// lastModified against its tags' tombstones (eno:isrtag:*, in next_cache_tag),
// L1s refresh the tag table within seconds, and every listing page carries the
// route-level tag _N_T_/listings/[id]/page — one row kills them all.
//
// Run after ANY visual/structural change to src/app/listings/[id] or the components
// it bakes (listing-gallery, pdp-shop-link, seller cards…). Each page re-renders on
// its next visit.
//
//   set -a; . ./.env; set +a; node scripts/purge-isr-listings.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }
const c = new pg.Client({ connectionString: url })
await c.connect()
const tags = [
  'eno:isrtag:_N_T_/listings/[id]/page',
  'eno:isrtag:_N_T_/listings/[id]/layout',
  'eno:isrtag:_N_T_/listings/layout',
]
// Mirror of cache-handler.cjs revalidateTag: greatest() so a replayed purge can
// never move a tombstone backward and revive newer invalidations.
await c.query(
  `insert into next_cache_tag (tag, stamp, expires_at)
   select t, $2, now() + interval '40 days' from unnest($1::text[]) as t
   on conflict (tag) do update set
     stamp = greatest(next_cache_tag.stamp, excluded.stamp),
     expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`,
  [tags, Date.now()],
)
console.log('tombstoned the listing route tags — every baked PDP regenerates on next visit (L1s pick it up within seconds)')
await c.end()
