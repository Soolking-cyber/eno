#!/usr/bin/env node
// ── Content-integrity probe ─────────────────────────────────────────────────────────
// Catalog data rots silently: an image URL 404s, a row points at a host that next/image
// won't optimize, a price serializes as null. None throw at runtime — the buyer just sees a
// broken card. This samples the live feed and verifies every listing image is (a) on an
// allowed host and (b) actually fetchable, plus that prices are well-formed. NON-DESTRUCTIVE.
//
//   node scripts/content-integrity.mjs [baseUrl]   # default https://eno.vn (or PROBE_BASE)
//   SAMPLE=80 node scripts/content-integrity.mjs    # how many listings to sample
const BASE = (process.argv[2] || process.env.PROBE_BASE || 'https://eno.vn').replace(/\/$/, '')
const SAMPLE = Number(process.env.SAMPLE || 60)
// Hosts next/image is configured to optimize (keep in sync with next.config remotePatterns).
const ALLOWED_HOSTS = ['supabase.co', 'picsum.photos', 'loremflickr.com']
let pass = 0, fail = 0
const lines = []
const ok = (n, c, d = '') => { lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`); c ? pass++ : fail++ }

// Bounded-concurrency map so we don't hammer the image host.
async function pool(items, n, fn) {
  const out = []; let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

async function main() {
  console.log(`# content-integrity → ${BASE}  (sampling ${SAMPLE} listings)\n`)

  const res = await fetch(`${BASE}/api/listings?limit=${SAMPLE}`).then((r) => r.json()).catch((e) => ({ _err: String(e) }))
  const listings = res?.listings || []
  ok('feed: /api/listings returns rows', listings.length > 0, `${listings.length} rows`)
  if (!listings.length) { console.log(lines.join('\n')); process.exit(1) }

  // 1. Prices well-formed (non-negative finite number).
  const badPrice = listings.filter((l) => typeof l.price !== 'number' || !Number.isFinite(l.price) || l.price < 0)
  ok('prices: all finite & ≥ 0', badPrice.length === 0, badPrice.length ? `${badPrice.length} bad (e.g. ${badPrice[0]?.id})` : '')

  // 2. Every listing has at least one image.
  const noImg = listings.filter((l) => !Array.isArray(l.images) || l.images.length === 0)
  ok('images: every listing has ≥1 image', noImg.length === 0, noImg.length ? `${noImg.length} with none` : '')

  // 3. Collect unique image URLs; check host allow-list.
  const urls = [...new Set(listings.flatMap((l) => (Array.isArray(l.images) ? l.images : [])).filter((u) => typeof u === 'string'))]
  const offHost = urls.filter((u) => { try { const h = new URL(u).hostname; return !ALLOWED_HOSTS.some((a) => h.endsWith(a)) } catch { return true } })
  ok('images: all on an allowed (optimizable) host', offHost.length === 0, offHost.length ? `${offHost.length} off-host (e.g. ${offHost[0]})` : `${urls.length} urls`)

  // 4. Every unique image actually fetches (200, image/*). This is the broken-card guard.
  const checks = await pool(urls, 8, async (u) => {
    try {
      let r = await fetch(u, { method: 'HEAD' })
      if (r.status === 405 || r.status === 501) r = await fetch(u, { headers: { range: 'bytes=0-0' } }) // some CDNs reject HEAD
      const ct = r.headers.get('content-type') || ''
      return { u, status: r.status, ct, good: (r.status === 200 || r.status === 206) && ct.startsWith('image/') }
    } catch (e) { return { u, status: 0, ct: '', good: false, err: String(e) } }
  })
  const broken = checks.filter((c) => !c.good)
  ok('images: every sampled image fetches (200, image/*)', broken.length === 0,
    broken.length ? `${broken.length}/${urls.length} broken (e.g. ${broken[0].u} → ${broken[0].status} ${broken[0].ct})` : `${urls.length} ok`)

  // 5. Money renders on the homepage (formatted VND, not a raw number).
  const home = await fetch(`${BASE}/`).then((r) => r.text()).catch(() => '')
  ok('money: homepage shows formatted VND', /\d{1,3}([.,]\d{3})+\s*(VND|₫)|\b(VND|₫)\b/.test(home))

  console.log(lines.join('\n'))
  console.log(`\n${pass}/${pass + fail} passed` + (fail ? `  (${fail} FAILED)` : '  — all green'))
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('content-integrity crashed:', e); process.exit(1) })
