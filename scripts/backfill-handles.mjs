// One-off backfill: give every existing Seller (storefront) and Profile a public
// @handle derived from its name — Telegram-style, one global namespace (Handle PK).
// Sellers claim first (storefronts are the shareable asset), then profiles.
// Seed storefronts (id LIKE 'seller-%', unowned mock data) are SKIPPED so they
// don't squat good names; they'll be purged before launch anyway.
// Idempotent: owners that already have a handle are left alone.
//
// Run:  cd /Users/mk1e3/eno.vn && set -a; . ./.env; set +a; node scripts/backfill-handles.mjs
import pg from 'pg'

const RESERVED = new Set([
  'about','account','admin','api','appeal','auth','brands','c','dashboard','developers',
  'guide','help','listings','messages','onboard','post','privacy','prohibited','regulations',
  'reports','safety','saved','search','sellers','signin','signup','sitemap','terms','trust',
  'eno','enovn','eno_vn','official','support','moderator','mod','staff','team','security',
  'verify','verified','system','notifications','billing','payment','payments','root','www',
  'mail','info','contact','login','logout','settings','user','null','undefined','anonymous',
])
const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/

// Mirrors src/lib/handle.ts slugifyHandle (fold → underscore, letter-first, ≥3).
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
function slugify(name) {
  let s = fold(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_').slice(0, 30).replace(/_+$/, '')
  if (!/^[a-z]/.test(s)) s = `u${s}`.slice(0, 30).replace(/_+$/, '')
  while (s.length < 3) s += String(Math.floor(Math.random() * 10))
  return s
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL })
  await c.connect()

  const taken = new Set((await c.query('select handle from "Handle"')).rows.map((r) => r.handle))
  const pick = (name) => {
    const b = slugify(name)
    const cands = [b, ...Array.from({ length: 98 }, (_, i) => `${b.slice(0, 28)}${i + 2}`)]
    for (const h of cands) {
      if (!HANDLE_RE.test(h) || RESERVED.has(h) || taken.has(h)) continue
      taken.add(h)
      return h
    }
    const r = `${b.slice(0, 25)}_${Math.floor(1000 + Math.random() * 9000)}`
    taken.add(r)
    return r
  }

  // 1) Real storefronts (skip mock seeds).
  const sellers = await c.query(`
    select s.id, s.name from "Seller" s
    left join "Handle" h on h."sellerId" = s.id
    where h.handle is null and s.id not like 'seller-%'
    order by s."memberSince" asc`)
  let sn = 0
  for (const s of sellers.rows) {
    await c.query('insert into "Handle" (handle, "sellerId") values ($1, $2) on conflict do nothing', [pick(s.name), s.id])
    sn++
  }

  // 2) Profiles (displayName; email-mask fallbacks like "al***" slugify fine).
  const profiles = await c.query(`
    select p.id, p."displayName" from "Profile" p
    left join "Handle" h on h."profileId" = p.id
    where h.handle is null
    order by p."createdAt" asc`)
  let pn = 0
  for (const p of profiles.rows) {
    await c.query('insert into "Handle" (handle, "profileId") values ($1, $2) on conflict do nothing', [pick(p.displayName || 'user'), p.id])
    pn++
  }

  const all = await c.query('select handle, "profileId", "sellerId" from "Handle" order by "createdAt"')
  console.log(`sellers claimed: ${sn}, profiles claimed: ${pn}, total handles: ${all.rows.length}`)
  for (const r of all.rows) console.log(`  @${r.handle}  →  ${r.sellerId ? 'shop ' + r.sellerId : 'user ' + r.profileId}`)
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
