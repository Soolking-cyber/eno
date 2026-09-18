/**
 * ASK EVERY PARTNER SHOP ONE QUESTION — "do you carry this?" — WITHOUT WALKING ITS CATALOGUE.
 *
 *   npx tsx scripts/partner-probe.ts --match 'iphone.?18|iphone.?duo|iphone.?fold'
 *   npx tsx scripts/partner-probe.ts --match 'iphone.?18' --store bachlongstore.vn
 *
 * ⛔ WHY THIS EXISTS RATHER THAN `partner-fetch --limit`. A blanket read is ~1,200 products at a
 * 1,200ms politeness gap — twenty-odd minutes PER SHOP, so ten hours across the twenty-three — and
 * it answers a question nobody asked ("what are the first 1,200 things you sell?"). Discovery here
 * is a URL/name match against each shop's own INDEX, which is a handful of requests, and only the
 * matches are fetched as product pages. Checking all 23 shops for one phone model costs minutes.
 *
 * ⚠️ IT IS A DISCOVERY TOOL AND WRITES NOTHING. Output is a staging JSON in exactly the shape
 * `import-partners.ts --file` consumes, so the existing dry-run → review → `--apply` path is
 * unchanged. Nothing about this shortens the human step.
 *
 * ⚠️ AND IT REPORTS WHAT IT COULD NOT ASK. A shop whose index this cannot read is printed as
 * `unreadable` with the reason, never silently as "carries none" — those two are the same shape in
 * a list of zero results, and conflating them is how "we checked everywhere" becomes false.
 */
import 'dotenv/config'
import { writeFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PARTNER_STORES } from '../src/lib/partner-stores'
import { readProductPages } from '../src/lib/partner-fetch'
import type { StoreConfig, PartnerProduct, ReadLog } from '../src/lib/partner-fetch'

const execFileP = promisify(execFile)
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const MATCH = new RegExp(arg('match') ?? 'iphone.?18|iphone.?duo', 'i')
const ONLY = arg('store')
const OUT = arg('out')
const GAP = Number(arg('gap') ?? 1200)
const MAX_PER_STORE = Number(arg('max') ?? 60)

/**
 * ⛔ `curl`, NOT `fetch`, FOR INDEX READS — measured 2026-09-19 and it is the whole reason
 * thegioididong.com read as "0 usable products" for the blanket scrape. That host RESETS Node's
 * fetch (ECONNRESET) while curl on the same URL, same second, same user-agent gets 200: it
 * fingerprints the TLS client, exactly like the Tiki product API does.
 *
 * ⚠️ THIS IS A CLI-ONLY TOOL, WHICH IS WHY IT MAY DO THIS AND `src/lib/partner-fetch.ts` MAY NOT.
 * That module is imported by /api/cron/partner-stock, and the runner image is `node:24-slim`, which
 * has NO curl — a curl path there would work on a laptop and silently fail in the container. Fixing
 * the cron for this shop is a Dockerfile decision, not a code one, and it is not made here.
 */
async function getText(url: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('curl', [
      /**
       * ⚠️ `--fail` IS NOT OPTIONAL HERE. Without it curl exits 0 on a 403 or 500 and hands back
       * the error page's HTML, which this function then reports as a successful read — a blocked
       * shop appears fully checked and carrying nothing. That is precisely the conflation this
       * script's header promises not to make.
       */
      '-sSL', '--fail', '--compressed', '--max-time', '45',
      '-A', 'eno-partner-fetch (+https://eno.vn)',
      url,
    ], { maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch { return null }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Candidate product URLs a shop's own index offers, filtered to the match before anything is fetched. */
async function discover(cfg: StoreConfig): Promise<{ urls: string[]; unreadable: string | null }> {
  const c = cfg as unknown as Record<string, unknown>
  const urlMatch = c.urlMatch ? new RegExp(String(c.urlMatch)) : null
  /**
   * ⚠️ `decodeURIComponent` THROWS on a malformed escape like `%ZZ`, and one bad URL in one
   * sitemap used to abort the whole run — every later shop unvisited and the staging file never
   * written, because it is written after the loop. A URL that cannot be decoded is matched raw.
   */
  const keep = (u: string) => {
    let decoded = u
    try { decoded = decodeURIComponent(u) } catch { /* keep the raw form */ }
    return MATCH.test(decoded) && (!urlMatch || urlMatch.test(u))
  }

  if (cfg.adapter === 'sitemap-jsonld') {
    const maps = (c.sitemaps as string[] | undefined) ?? []
    if (!maps.length) return { urls: [], unreadable: 'no sitemaps configured' }
    const found = new Set<string>()
    let read = 0
    for (const m of maps) {
      const xml = await getText(m)
      await sleep(GAP / 4)
      if (!xml) continue
      read++
      for (const loc of xml.match(/<loc>([^<]+)<\/loc>/g) ?? []) {
        const u = loc.slice(5, -6).trim()
        if (keep(u)) found.add(u)
      }
      if (found.size >= MAX_PER_STORE) break
    }
    return { urls: [...found], unreadable: read ? null : 'every sitemap failed to fetch' }
  }

  if (cfg.adapter === 'woocommerce') {
    /**
     * ⚠️ THE STORE API'S OWN `search` PARAM, so the shop does the filtering. `cfg.endpoint` carries
     * a `{page}` placeholder and usually a per_page; appending is safe because every configured
     * endpoint already has a query string.
     */
    const base = cfg.endpoint.replace('{page}', '1')
    /**
     * ⛔ THE UPSTREAM SEARCH TERM MUST FOLLOW `--match`, and hardcoding it was a silent wrong
     * answer: `--match 'galaxy'` asked the shop for "iphone" and then filtered those results for
     * Galaxy, reporting a confident zero. `--q` still overrides for the cases where the shop's own
     * search wants a different word than the regex.
     */
    const q = arg('q') ?? (arg('match') ?? 'iphone').replace(/[^a-z0-9 ]+/gi, ' ').trim().split(/\s+/)[0]
    const url = `${base}${base.includes('?') ? '&' : '?'}search=${encodeURIComponent(q)}`
    const body = await getText(url)
    if (!body) return { urls: [], unreadable: 'store API unreachable' }
    try {
      const rows = JSON.parse(body) as { name?: string; permalink?: string }[]
      if (!Array.isArray(rows)) return { urls: [], unreadable: 'store API did not return a list' }
      const hits = rows.filter((r) => MATCH.test(String(r.name ?? ''))).map((r) => String(r.permalink)).filter(Boolean)
      /**
       * ⚠️ PAGE ONE ONLY. A match sitting on page 2 of the shop's own search is invisible here, so a
       * zero from a FULL first page is "not in the first 100 results", not "not sold" — and the two
       * must not read alike. A short page means the result set really did end.
       */
      return { urls: hits, unreadable: !hits.length && rows.length >= 100 ? 'searched page 1 only and it was full — a match may sit deeper' : null }
    } catch { return { urls: [], unreadable: 'store API returned non-JSON' } }
  }

  if (cfg.adapter === 'haravan' || cfg.adapter === 'sapo') {
    // Shopify-shaped `/collections/<handle>/products.json`; the configured endpoint already names one.
    const body = await getText(cfg.endpoint.replace('{page}', '1'))
    if (!body) return { urls: [], unreadable: 'products.json unreachable' }
    try {
      const j = JSON.parse(body) as { products?: { title?: string; handle?: string }[] }
      const hits = (j.products ?? []).filter((p) => MATCH.test(String(p.title ?? '')))
      return { urls: hits.map((p) => `https://${cfg.domain}/products/${p.handle}`), unreadable: null }
    } catch { return { urls: [], unreadable: 'products.json returned non-JSON' } }
  }

  // collection-crawl shops have no index this can query cheaply — say so rather than report zero.
  return { urls: [], unreadable: `adapter '${cfg.adapter}' has no cheap index; needs a full crawl` }
}

async function main() {
  const stores = PARTNER_STORES.filter((s) => !ONLY || (s as unknown as { domain: string }).domain === ONLY)
  const all: PartnerProduct[] = []
  const report: { domain: string; found: number; imported: number; unreadable: string | null }[] = []

  for (const cfg of stores) {
    const domain = (cfg as unknown as { domain: string }).domain
    process.stdout.write(`\n=== ${domain} (${cfg.adapter}) — discovering… `)
    const { urls, unreadable } = await discover(cfg)
    if (unreadable) { console.log(`UNREADABLE: ${unreadable}`); report.push({ domain, found: 0, imported: 0, unreadable }); continue }
    console.log(`${urls.length} candidate URL(s)`)
    if (!urls.length) { report.push({ domain, found: 0, imported: 0, unreadable: null }); continue }

    // Only the matches are fetched as product pages — the whole point of the probe.
    /**
     * ⚠️ THE READ STILL GOES THROUGH THE MODULE'S OWN `fetch`, so a host that resets Node — as
     * thegioididong.com does — discovers fine here and then reads ZERO. That is reported below as
     * its own state rather than as "carries none".
     */
    const log: ReadLog = { attempted: 0, failed: 0, fatal: false }
    const products = await readProductPages(cfg, new Set(urls.slice(0, MAX_PER_STORE)), MAX_PER_STORE, log)
    for (const p of products) console.log(`    ${String(p.price).padStart(12)} | ${p.name.slice(0, 70)}`)
    all.push(...products)
    report.push({
      domain, found: urls.length, imported: products.length,
      unreadable: products.length === 0 ? 'index readable, but every product page failed to fetch (host may reset Node fetch)' : null,
    })
  }

  console.log('\n' + '='.repeat(60))
  for (const r of report) {
    const state = r.unreadable ? `UNREADABLE — ${r.unreadable}` : `${r.found} matched, ${r.imported} priced`
    console.log(`  ${r.domain.padEnd(24)} ${state}`)
  }
  console.log(`\ntotal priced products: ${all.length}`)
  if (OUT) {
    /**
     * ⛔ NEVER CLOBBER A STAGING FILE. The whole contract of this tool is that a human reads the
     * JSON before `import-partners.ts --apply` runs against it; silently replacing a reviewed file
     * with a later, possibly shorter run means the review approved contents that no longer exist.
     */
    if (existsSync(OUT) && !process.argv.includes('--force')) {
      console.error(`\nREFUSING to overwrite ${OUT} — it may already have been reviewed. Pass --force or choose another --out.`)
      process.exitCode = 1
      return
    }
    writeFileSync(OUT, JSON.stringify(all, null, 2))
    console.log(`staged → ${OUT}   (nothing published; review before importing)`)
  }
  else console.log('no --out given, so nothing was written.')
}

void main()
