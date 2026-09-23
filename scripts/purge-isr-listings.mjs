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
// ⛔ A SILENT NO-OP ON THE VN BOX UNTIL ENO_ISR_PG EXISTED. cache-handler.cjs only read tombstones
// when K_SERVICE was set — a Cloud Run variable — so after the 2026-08-21 move this script wrote its
// rows correctly and no container ever looked at them (run 2026-09-14: nothing changed). It works
// only where apps.compose.yml sets ENO_ISR_PG=1; check `docker exec eno-vn-app printenv ENO_ISR_PG`
// before trusting it.
//
// Run after ANY visual/structural change to src/app/[lang]/listings/[id] or the components
// it bakes (listing-gallery, pdp-shop-link, seller cards…). Each page re-renders on
// its next visit.
//
//   set -a; . ./.env; set +a; node scripts/purge-isr-listings.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }
const c = new pg.Client({ connectionString: url })
await c.connect()
// ⛔ PREFIXED WITH `[lang]` SINCE 2026-09-17: pages render under the hidden language segment
// (src/proxy.ts), so a cached PDP carries `_N_T_/[lang]/listings/[id]/page` — the unprefixed tags
// below it are kept only so a purge still clears entries written by the previous build.
// ⚠️ AND IN THE `(pdp)` ROUTE GROUP SINCE 2026-09-23 (listings/[id]/(pdp)/layout.tsx): Next puts the
// group in the tag, so the page tag is now `…/[id]/(pdp)/page`. `…/[id]/layout` is the one that
// matches every build — it is on every page under the segment, groups or not.
const tags = [
  'eno:isrtag:_N_T_/[lang]/listings/[id]/(pdp)/page',
  'eno:isrtag:_N_T_/[lang]/listings/[id]/page',
  'eno:isrtag:_N_T_/[lang]/listings/[id]/layout',
  'eno:isrtag:_N_T_/[lang]/listings/layout',
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
