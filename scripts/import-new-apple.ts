/**
 * Import the NEW iPhone 18 Pro / Pro Max / Duo and current Macs one AccessTrade partner shop lists, as chat-only listings
 * on its pinned eno-run storefront (owner 2026-11-26 — src/lib/new-apple.ts is the rule and the why).
 *
 *   set -a; . ~/eno.vn/.env; set +a
 *   npx tsx scripts/import-new-apple.ts --shop shopdunk_web                                     # DRY RUN (reads only)
 *   npx tsx scripts/import-new-apple.ts --shop shopdunk_web --apply --journal-dir ~/eno-journals/new-apple --serving <sha the box serves>
 *   npx tsx scripts/import-new-apple.ts --undo ~/eno-journals/new-apple/<journal>.json [--apply]  # hide what a run created
 *
 * ⛔ CREATE-ONLY. A `new:` row this shop already has is left alone, whatever its state — its price and stock are the
 * nightly's (src/lib/new-apple-night.ts), and a hidden or removed one stays as it is.
 * ⛔ FROM THE PRODUCT PAGE. Candidates come from the shop's catalogue (ShopDunk's /iphone and /mac pages; CellphoneS' and
 * Hoàng Hà's AccessTrade datafeed, for the URL only); the price, the stock and the name are then read from each product's
 * OWN page (src/lib/new-apple-read.ts). Only a page that reads "in stock" with a plausible price is created.
 * ⛔ CHAT ONLY. The public `affiliateUrl` is NULL; the tracking link (`trackingLink(campaignId, page)`, the crawl's builder)
 * goes to PartnerPurchaseLink in the same transaction. Refused unless the storefront is a pinned eno-run pair.
 * ⛔ RUN ONLY ON A BOX THAT IS ALREADY SERVING THE `held` EXCLUSION (src/lib/affiliate-night.ts `NOT_NEW_APPLE`) — before it,
 * the 03:01 / 04:31 used-shelf nights send every active row this creates to `sold` — AND WITH eno-cron-new-apple.timer ENABLED.
 * --apply checks both (`--serving <sha>` against git; the timer over ssh) and refuses otherwise.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { categoryFor, subcategoryFor } from '../src/lib/feed-taxonomy'
import { buildSearchText } from '../src/lib/fold'
import { browseRankScore } from '../src/lib/ranking-formula'
import { ImportScreen } from '../src/lib/import-screen'
import { decodeEntities } from '../src/lib/feed-text'
import { isEnoRunPartner } from '../src/lib/eno-run-partners'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'
import { trackingLink } from '../src/lib/accesstrade-crawl-feed'
import { accessTradeGet } from '../src/lib/affiliate-price-refresh'
import { mkdirDurably, writeFileDurably } from '../src/lib/durable-file'
import { NEW_APPLE_PREFIX, NEW_APPLE_SHOPS, newAppleLine, type NewAppleShop } from '../src/lib/new-apple'
import { fetchProductPage, readProduct, shopDunkCards } from '../src/lib/new-apple-read'
import { newAppleText, plausibleNewPrice } from '../src/lib/new-apple-text'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }

/**
 * ⛔ --apply NAMES THE COMMIT THE BOX IS SERVING (`--serving <sha>`, from the deploy's "serving <sha>" line), and refuses unless
 * that commit already carries the `held` exclusion (commit gate round 4: a hand-checked precondition is not one). The commit
 * that added NOT_NEW_APPLE to affiliate-night.ts must be an ancestor of what serves, or the 03:01 night sells every row.
 */
/**
 * ⛔ AND THE NIGHTLY MUST ALREADY BE ON (commit gate round 5): it is the only thing that ever re-prices these rows or takes them
 * down (out of stock, gone, or unconfirmed for 7 days). Read on the box over the deploy's own ssh; enable it before importing.
 */
function nightlyOff(): string | null {
  try {
    const out = execFileSync('ssh', ['-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=15', '-i', `${homedir()}/.ssh/CS-Linux-20260920135129228.pem`, '-p', '24700', 'root@162.4.176.233', 'systemctl is-enabled eno-cron-new-apple.timer'], { encoding: 'utf8' }).trim()
    return out === 'enabled' ? null : `eno-cron-new-apple.timer is "${out}" on the box — enable it first: systemctl enable --now eno-cron-new-apple.timer`
  } catch (e) {
    return `could not confirm eno-cron-new-apple.timer is enabled on the box (${(e as Error).message.slice(0, 80)}) — enable it first`
  }
}

function servingHasExclusion(serving: string): string | null {
  if (!/^[0-9a-f]{7,40}$/.test(serving)) return `--serving must be a commit sha, got "${serving}"`
  const run = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  try { run(['fetch', '-q', 'origin', 'main']) } catch { /* offline: the local objects may still answer */ }
  const added = run(['log', '-S', 'NOT_NEW_APPLE', '--format=%H', '--reverse', 'origin/main', '--', 'src/lib/affiliate-night.ts']).split('\n')[0]
  if (!added) return 'the exclusion commit is not on origin/main yet — push and deploy first'
  try { execFileSync('git', ['merge-base', '--is-ancestor', added, serving]) } catch { return `the box serves ${serving}, which does not contain ${added.slice(0, 9)} (the held exclusion) — deploy it first` }
  return null
}
const APPLY = process.argv.includes('--apply')
const UNDO = arg('undo')
const JOURNAL_DIR = arg('journal-dir')
const LIMIT = Number(arg('limit') ?? 0)
const PACE_MS = 1_200
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Candidate = { sku: string; url: string; name: string; image: string | null }
type Created = { id: string | null; externalId: string; sellerId: string; title: string; price: number; updatedAt: string | null }

/** ShopDunk: its own catalogue pages, server-rendered (measured 2026-11-26: /iphone 34 cards, /mac 2 pages, 68). */
async function shopDunkCandidates(): Promise<{ rows: Candidate[]; complete: boolean }> {
  const rows: Candidate[] = []
  let complete = true
  for (const path of ['/iphone', '/iphone?pagenumber=2', '/mac', '/mac?pagenumber=2', '/mac?pagenumber=3']) {
    await sleep(PACE_MS)
    const page = await fetchProductPage(`https://shopdunk.com${path}`)
    if ('error' in page || page.status !== 200) { if (!/pagenumber=[23]/.test(path)) complete = false; continue }
    for (const c of shopDunkCards(page.html)) rows.push({ sku: c.productId, url: c.url, name: c.name, image: c.image })
  }
  return { rows, complete }
}

/** CellphoneS / Hoàng Hà: the datafeed, for each product's URL and SKU only (its price and stock are not read). */
async function feedCandidates(shop: NewAppleShop): Promise<{ rows: Candidate[]; complete: boolean }> {
  const KEY = process.env.ACCESSTRADE_KEY
  if (!KEY) throw new Error('ACCESSTRADE_KEY missing')
  const rows: Candidate[] = []
  let total = Infinity
  let read = 0
  for (let page = 1; read < total && page <= 200; page++) {
    const res = await accessTradeGet(`https://api.accesstrade.vn/v1/datafeeds?campaign=${shop.campaign}&limit=200&page=${page}`, KEY)
    if (!res.ok) return { rows, complete: false }
    const body = await res.json() as { total?: number; data?: { name: string; url: string; sku?: string; product_id?: string; image?: string }[] }
    total = body.total ?? 0
    const data = body.data ?? []
    if (!data.length) break
    read += data.length
    for (const r of data) {
      const sku = String(r.sku || r.product_id || '').trim()
      if (sku && r.url) rows.push({ sku, url: r.url, name: decodeEntities(String(r.name ?? '')), image: r.image || null })
    }
  }
  return { rows, complete: read >= total }
}

async function main() {
  if (UNDO) return undo(UNDO)
  const shop = NEW_APPLE_SHOPS.find((s) => s.campaign === arg('shop'))
  if (!shop) { console.error(`--shop must be one of ${NEW_APPLE_SHOPS.map((s) => s.campaign).join(', ')}`); process.exit(1) }
  if (APPLY && (!JOURNAL_DIR || JOURNAL_DIR.startsWith('--'))) { console.error('--apply needs --journal-dir <durable dir outside the repo>'); process.exit(1) }
  if (APPLY) {
    const why = servingHasExclusion(arg('serving') ?? '') ?? nightlyOff()
    if (why) { console.error(`⛔ ${why}`); process.exit(1) }
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — new Apple from ${shop.name}\n`)

  const seller = await db.seller.findUnique({ where: { id: shop.sellerId }, select: { id: true, name: true, ownerId: true, officialPartner: true, trustScore: true } })
  if (!isEnoRunPartner(seller)) { console.error(`⛔ ${shop.sellerId} (${shop.name}) is not a pinned eno-run pair — refusing before any read`); process.exit(1) }

  let release = () => {}
  if (APPLY) {
    const lockDir = join(homedir(), 'eno-journals', 'new-apple')
    const lock = join(lockDir, `import-new-apple-${shop.campaign}.lock`)
    mkdirDurably(lockDir)
    try { closeSync(openSync(lock, 'wx')) } catch { console.error(`another --apply run of ${shop.campaign} holds ${lock} — check, remove, re-run`); process.exit(1) }
    release = () => { try { unlinkSync(lock) } catch { /* gone */ } }
    process.on('exit', release)
  }

  const listed = shop.campaign === 'shopdunk_web' ? await shopDunkCandidates() : await feedCandidates(shop)
  console.log(`catalogue: ${listed.rows.length} products (complete=${listed.complete})`)
  // ⛔ One row per product page and per title: CellphoneS lists parent/child SKUs of one page, and two rows of one shop with
  // one title are noindexed as duplicate imports (src/lib/duplicate-import.ts).
  const seenUrl = new Set<string>()
  // ⛔ …and against the titles this storefront ALREADY holds under `new:` (commit gate, opus): CellphoneS' parent/child SKUs of
  // one page can come in another order on a re-run, and the sibling SKU would be created beside the first one's row.
  const stored = await db.listing.findMany({ where: { sellerId: shop.sellerId, externalId: { startsWith: NEW_APPLE_PREFIX } }, select: { title: true } })
  // Two sets (commit gate round 5): `seenTitle` dedupes the CATALOGUE names; `heldTitles` is every FINAL title the storefront
  // holds or this run has created, checked again once the product page has named the item.
  const seenTitle = new Set<string>(stored.map((r) => r.title.toLowerCase()))
  const heldTitles = new Set<string>(stored.map((r) => r.title.toLowerCase()))
  const lines = listed.rows.flatMap((c) => {
    const line = newAppleLine(c.name, c.url)
    if (!line) return []
    const key = c.url.replace(/[?#].*$/, '')
    const title = newAppleText.englishTitle(c.name).toLowerCase()
    if (seenUrl.has(key) || seenTitle.has(title)) return []
    seenUrl.add(key); seenTitle.add(title)
    return [{ ...c, url: key, line }]
  })
  console.log(`new-Apple lines: ${lines.length}`)

  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))
  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const secret = process.env.SUPABASE_SECRET_KEY
  if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
  const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from('listings') : null
  const hostImage = makeImageHost({ storage, storageUrl: storageUrl ?? 'https://invalid', bucket: 'listings', edge: 1200, quality: 80 })
  const screen = new ImportScreen(`new-apple-${shop.campaign}`, { db, sellerIds: [shop.sellerId] })
  const journalName = `new-apple-${shop.campaign}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const created: Created[] = []
  const writeJournal = () => { if (APPLY) writeFileDurably(JOURNAL_DIR!, journalName, JSON.stringify({ kind: 'new-apple-import', shop: shop.campaign, sellerId: shop.sellerId, created }, null, 1)) }
  const counts = { held: 0, notIn: 0, implausible: 0, screened: 0, noImage: 0, created: 0, wouldCreate: 0, failed: 0 }
  const now = new Date()

  try {
    for (const c of LIMIT ? lines.slice(0, LIMIT) : lines) {
      const externalId = `${NEW_APPLE_PREFIX}${c.sku}`.slice(0, 190)
      const existing = await db.listing.findFirst({ where: { sellerId: shop.sellerId, externalId }, select: { id: true, status: true } })
      if (existing) { counts.held++; continue }
      await sleep(PACE_MS)
      const page = await readProduct(shop, c.url, c.sku, c.line.model)
      if (page.kind !== 'in') { counts.notIn++; console.log(`  · ${c.name.slice(0, 60)}: ${page.kind}${'why' in page ? ` (${page.why})` : ''}`); continue }
      if (!plausibleNewPrice(c.line, page.price)) { counts.implausible++; console.log(`  · ${c.name.slice(0, 60)}: price ${page.price} not plausible`); continue }
      const name = page.name ?? c.name
      const slug = categoryFor(name)
      const sub = subcategoryFor(slug, name)
      const categoryId = catId.get(slug)
      if (!categoryId || (sub !== 'phones-tablets' && sub !== 'laptops-pcs')) { counts.screened++; console.log(`  · ${name.slice(0, 60)}: filed ${slug}/${sub}`); continue }
      const text = newAppleText.describe({ name, line: c.line, shop })
      // The FINAL title (from the page's own name) against every title held and created (commit gate rounds 2 and 5, opus).
      if (heldTitles.has(text.title.toLowerCase())) { counts.held++; continue }
      if (!(await screen.check({ title: name, description: text.descriptionVi, category: slug, subcategory: sub, merchant: shop.name, externalId, url: c.url }, null))) { counts.screened++; continue }
      if (!APPLY) { counts.wouldCreate++; console.log(`  + ${text.title} — ${page.price.toLocaleString('vi-VN')} ₫ [${c.line.model}]`); continue }
      // Photos: the page's own gallery first (Hoàng Hà, CellphoneS), the catalogue image as a fallback. At most 4.
      const sources = [...page.images, ...(c.image ? [c.image] : [])].filter((u, i, a) => a.indexOf(u) === i).slice(0, 4)
      const hosted: string[] = []
      for (const src of sources) { const u = await hostImage(src, slug); if (u) hosted.push(u) }
      if (!hosted.length) { counts.noImage++; continue }
      const city = shop.city
      // ⛔ JOURNALED BEFORE THE WRITE (commit gate round 2, opus): the pending entry names the externalId, so a row whose
      // post-commit journal write failed is still found by --undo (by storefront + externalId). A journal that cannot be
      // written stops the run before anything is created.
      const entry: Created = { id: null, externalId, sellerId: shop.sellerId, title: text.title, price: page.price, updatedAt: null }
      created.push(entry)
      writeJournal()
      try {
        const id = await db.$transaction(async (tx) => {
          const { id } = await tx.listing.create({
            data: {
              sellerId: shop.sellerId, externalId,
              title: text.title, titleVi: text.titleVi, description: text.description, descriptionVi: text.descriptionVi,
              price: page.price, priceUnit: '', currency: '₫', negotiable: false, condition: 'new',
              images: JSON.stringify(hosted), categoryId, subcategorySlug: sub, brandSlug: 'apple', model: c.line.model,
              location: city, city,
              searchText: buildSearchText([text.title, text.titleVi, text.description, text.descriptionVi, city, slug, 'apple', c.line.model]),
              affiliateUrl: null, verified: true, status: 'active',
              rankScore: browseRankScore({ sellerTrustScore: seller!.trustScore ?? 100, postedAt: now, featured: false }),
            },
            select: { id: true },
          })
          await tx.partnerPurchaseLink.create({ data: { listingId: id, url: trackingLink(shop.campaignId, c.url) } })
          // The row's own stamp, read in the same transaction: --undo takes down only a row nothing has written since.
          const [stamp] = await tx.$queryRawUnsafe<{ updatedAt: string }[]>(`SELECT "updatedAt"::text AS "updatedAt" FROM "Listing" WHERE id = $1`, id)
          if (!stamp?.updatedAt) throw new Error(`created ${id} but read no stamp`)
          return { id, updatedAt: stamp.updatedAt }
        }, { maxWait: 15_000, timeout: 30_000 })
        entry.id = id.id
        entry.updatedAt = id.updatedAt
        heldTitles.add(text.title.toLowerCase())
        counts.created++
        writeJournal()
        console.log(`  + ${id.id} ${text.title} — ${page.price.toLocaleString('vi-VN')} ₫`)
      } catch (e) {
        // A journal write that fails AFTER the commit is not swallowed: the row exists, and its entry must say so.
        if (entry.id) throw e
        created.splice(created.indexOf(entry), 1)
        writeJournal()
        counts.failed++
        console.log(`  ! ${name.slice(0, 60)}: ${(e as Error).message.slice(0, 100)}`)
      }
    }
  } finally {
    if (APPLY && created.length) await enqueuePhotoChecks(db, created.flatMap((r) => (r.id ? [r.id] : [])))
  }
  await screen.finish({ apply: APPLY })
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${JSON.stringify(counts)}`)
  if (APPLY && created.length) console.log(`journal: ${join(JOURNAL_DIR!, journalName)}`)
  if (APPLY && created.length) console.log('pages quoting these rows refresh within the hour (ISR 3600); purge the edge by tag (eno-html) to show them now')
  release()
}

/**
 * Hide the rows a run created that still say what the import wrote — same storefront, still `new:`, still active, the same
 * title and price (a nightly reprice or an admin edit changes them, and that row is a human's call: it is listed, not hidden).
 * The staff link stays with the hidden row; a hidden row shows no Buy now.
 */
async function undo(file: string) {
  const j = JSON.parse(readFileSync(file, 'utf8')) as { kind: string; sellerId: string; created: Created[] }
  if (j.kind !== 'new-apple-import') { console.error(`${file} is not a new-apple import journal`); process.exit(1) }
  let n = 0
  const touched: string[] = []
  for (const r of j.created) {
    if (!r.externalId.startsWith(NEW_APPLE_PREFIX) || r.sellerId !== j.sellerId) continue
    // A pending entry (the run died between the write and its journal line): found by storefront + externalId, and listed
    // for a human — with no stamp nothing proves the row is still as the import left it.
    if (!r.id || !r.updatedAt) {
      const row = await db.listing.findFirst({ where: { sellerId: j.sellerId, externalId: r.externalId }, select: { id: true, status: true } })
      if (row) touched.push(`${row.id} (pending entry, ${row.status})`)
      continue
    }
    // ⛔ BY CONTENT, NOT BY updatedAt (commit gate round 6): the photo check and other jobs touch a row without changing what it
    // says. A row still active at the import's own title and price is the import's to take down; a re-priced or re-titled one
    // (the nightly, an admin) is a human's call and is listed instead.
    const res = await db.$executeRaw`UPDATE "Listing" SET status = 'hidden', "updatedAt" = now()
      WHERE id = ${r.id} AND "sellerId" = ${j.sellerId} AND "externalId" = ${r.externalId} AND status = 'active'
        AND title = ${r.title} AND price = ${r.price} AND ${APPLY}`
    if (res) n += res
    else if (APPLY) touched.push(r.id)
    else {
      const still = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Listing" WHERE id = ${r.id} AND "sellerId" = ${j.sellerId} AND "externalId" = ${r.externalId} AND status = 'active' AND title = ${r.title} AND price = ${r.price}`
      if (still[0]?.n) n++; else touched.push(r.id)
    }
  }
  console.log(`${APPLY ? 'hidden' : 'would hide'} ${n} of ${j.created.length}`)
  if (APPLY && n) console.log('purge the edge by tag (eno-html, eno-public) so the hidden rows leave cached pages now; the iPhone pages refresh within the hour')
  if (touched.length) console.log(`written since the import (left for a human): ${touched.join(', ')}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
