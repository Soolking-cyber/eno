#!/usr/bin/env node
// ── SEO / structured-data / discoverability probe ──────────────────────────────────
// Organic reach depends on these being correct, and they break silently (a bad canonical
// or a missing Product schema costs ranking with zero runtime error). Checks the homepage
// head tags, a real listing's Product/Offer/Breadcrumb JSON-LD, canonical + social cards,
// and that sitemap URLs actually resolve. Discovers a live category + listing URL from the
// sitemap so it never hardcodes IDs. NON-DESTRUCTIVE (GET only).
//
//   node scripts/seo-check.mjs [baseUrl]    # default https://eno.vn (or PROBE_BASE)
const BASE = (process.argv[2] || process.env.PROBE_BASE || 'https://eno.vn').replace(/\/$/, '')
let pass = 0, fail = 0
const lines = []
const ok = (n, c, d = '') => { lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`); c ? pass++ : fail++ }
const get = (url) => fetch(url).then(async (r) => ({ status: r.status, body: await r.text() })).catch((e) => ({ status: 0, body: '', err: String(e) }))
const has = (html, re) => re.test(html)
// Collect every JSON-LD @type on the page (schemas may be nested or in @graph).
const ldTypes = (html) => [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1])

async function main() {
  console.log(`# seo-check → ${BASE}\n`)

  // ── Homepage head ────────────────────────────────────────────────────────────────
  const home = await get(`${BASE}/`)
  ok('home: 200', home.status === 200, String(home.status))
  ok('home: <html lang> set', has(home.body, /<html[^>]+lang=/i))
  ok('home: <title> non-empty', /<title>[^<]{5,}<\/title>/i.test(home.body))
  ok('home: meta description', has(home.body, /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i))
  ok('home: canonical link', has(home.body, /<link[^>]+rel=["']canonical["']/i))
  ok('home: og:title + og:image', has(home.body, /property=["']og:title["']/i) && has(home.body, /property=["']og:image["']/i))
  ok('home: twitter card', has(home.body, /name=["']twitter:card["']/i))
  ok('home: Organization/WebSite JSON-LD', ldTypes(home.body).some((t) => /Organization|WebSite/.test(t)))
  ok('home: NOT noindex', !has(home.body, /<meta[^>]+name=["']robots["'][^>]+noindex/i))

  // ── Sitemap resolves + sampling ────────────────────────────────────────────────────
  const sm = await get(`${BASE}/sitemap.xml`)
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  ok('sitemap: 200 + has <loc> urls', sm.status === 200 && locs.length > 0, `${locs.length} urls`)
  // Sample up to 3 sitemap URLs and confirm they resolve (not 404/410 — dead links hurt crawl budget).
  const sample = locs.filter((u, i) => i % Math.max(1, Math.floor(locs.length / 3)) === 0).slice(0, 3)
  for (const u of sample) {
    const r = await get(u)
    ok(`sitemap url resolves: ${u.replace(BASE, '') || '/'}`, r.status === 200, String(r.status))
  }

  // ── A real listing's structured data ──────────────────────────────────────────────
  const listingUrl = locs.find((u) => /\/listings\//.test(u))
  if (!listingUrl) {
    ok('listing: found a /listings/ url in sitemap', false, 'none in sitemap — skipping product-schema checks')
  } else {
    const l = await get(listingUrl)
    const types = ldTypes(l.body)
    ok(`listing ${listingUrl.replace(BASE, '')}: 200`, l.status === 200, String(l.status))
    ok('listing: Product JSON-LD', types.includes('Product'))
    ok('listing: Offer with price', has(l.body, /"@type"\s*:\s*"Offer"/) && has(l.body, /"price"\s*:/))
    ok('listing: BreadcrumbList', types.includes('BreadcrumbList'))
    ok('listing: canonical + og:image', has(l.body, /rel=["']canonical["']/i) && has(l.body, /property=["']og:image["']/i))
  }

  console.log(lines.join('\n'))
  console.log(`\n${pass}/${pass + fail} passed` + (fail ? `  (${fail} FAILED)` : '  — all green'))
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('seo-check crashed:', e); process.exit(1) })
