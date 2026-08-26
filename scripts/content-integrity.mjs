#!/usr/bin/env node
// ── Content-integrity probe ─────────────────────────────────────────────────────────
// Catalog data rots silently: an image URL 404s, a row points at a host that next/image
// won't optimize, a price serializes as null. None throw at runtime — the buyer just sees a
// broken card. This samples the live feed and verifies every listing image is (a) on an
// allowed host and (b) actually fetchable, plus that prices are well-formed. NON-DESTRUCTIVE.
//
//   node scripts/content-integrity.mjs [baseUrl]   # default https://eno.vn (or PROBE_BASE)
//   SAMPLE=80 node scripts/content-integrity.mjs    # how many listings to sample
// ⚠️ THE SHEBANG MUST STAY ON LINE 1 — an import placed above it makes node parse `#!` as code
// and the file dies with "Invalid or unexpected token". Needs the env because the legitimate
// storage host is derived from NEXT_PUBLIC_SUPABASE_URL below; sibling probes (smoke, seo-check)
// read no env, which is why none of them imported this.
import 'dotenv/config'

/**
 * ⛔ ONE PARSE, NOT TWO INDEPENDENT SCANS. `BASE` used to be `process.argv[2]` while the storage
 * host was found by `indexOf('--storage-host')` — so running EXACTLY what the error message below
 * tells you to run (`--storage-host sb.eno.vn`, no base url) set `BASE = '--storage-host'` and
 * every fetch went to `--storage-host/api/...`. Reproduced, not theorised. Strip the flag and its
 * value first, then take the first thing left.
 */
const ARGV = process.argv.slice(2)
const takeFlag = (name) => {
  const i = ARGV.indexOf(`--${name}`)
  if (i < 0) return undefined
  const v = ARGV[i + 1]
  if (!v || v.startsWith('--')) { console.error(`--${name} needs a value`); process.exit(1) }
  ARGV.splice(i, 2)
  return v
}
const STORAGE_FLAG = takeFlag('storage-host')
const BASE = (ARGV.find((a) => !a.startsWith('--')) || process.env.PROBE_BASE || 'https://eno.vn').replace(/\/$/, '')
const SAMPLE = Number(process.env.SAMPLE || 60)
/**
 * Hosts next/image is configured to optimize — DERIVED, not typed out, because "keep in sync with
 * next.config remotePatterns" is a comment and comments do not stay in sync.
 *
 * ⛔ THIS SAID `'supabase.co'` UNTIL 2026-08-26 AND THE CHECK HAD BEEN FAILING WHOLESALE. Storage
 * moved to the self-hosted box at sb.eno.vn; the match is `hostname.endsWith(allowed)`, and
 * 'sb.eno.vn'.endsWith('supabase.co') is false, so EVERY listing image read as off-host — 68 of 68
 * on a 12-listing sample, while the very next assertion confirmed all 68 fetch 200 image/*. A gate
 * that fails on everything is worth exactly as much as one that passes on everything.
 *
 * next.config.ts builds `remotePatterns` from NEXT_PUBLIC_SUPABASE_URL and hard-errors without it;
 * this reads the same variable so the two cannot disagree again. picsum/loremflickr are seed-data
 * hosts and stay.
 */
const STORAGE_HOST = (() => {
  // ⚠️ An explicit flag as well as the env, because sibling probes take NO env and this one is
  // documented as a standalone CLI. A runner without .env (CI, a bare shell) can pass the host
  // instead of being told to go and configure one.
  // ⚠️ AND BECAUSE THE ENV IS THE RUNNER'S, NOT THE TARGET'S. Probing a deployment whose storage
  // host differs from your local .env would flag every image as off-host — the failure this
  // rewrite exists to remove, re-entering through the back door. Pass --storage-host when the
  // target is not the one your .env points at.
  const raw = STORAGE_FLAG || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) {
    console.error('Cannot tell which storage host is legitimate.')
    console.error('Set NEXT_PUBLIC_SUPABASE_URL, or pass --storage-host sb.eno.vn.')
    console.error('⛔ Deliberately fatal: guessing would restore the bug this replaced — an allowlist')
    console.error('   that matches nothing fails on every image, and one that matches anything passes on every image.')
    process.exit(1)
  }
  try { return raw.includes('//') ? new URL(raw).hostname : raw } catch { console.error(`not a host or url: ${raw}`); process.exit(1) }
})()
const ALLOWED_HOSTS = [STORAGE_HOST, 'picsum.photos', 'loremflickr.com']

/**
 * ⛔ EXACT HOST OR A REAL SUBDOMAIN — never bare `endsWith`. `'attackersb.eno.vn'.endsWith('sb.eno.vn')`
 * is TRUE, so the previous form allowed any attacker-registered host ending in our name (and
 * `evilpicsum.photos` for the seed hosts). The dot boundary is the whole fix.
 */
const hostAllowed = (h) => ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`))
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
  const offHost = urls.filter((u) => { try { return !hostAllowed(new URL(u).hostname) } catch { return true } })
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
