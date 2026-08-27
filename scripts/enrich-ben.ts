import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { composeDescription, parseGallery, parseSpecs } from '../src/lib/merchant-specs'

/**
 * ENRICH THE IMPORTED BỀN LISTINGS from the merchant's own product pages.
 *
 *   npx tsx scripts/enrich-ben.ts                 · dry run, prints what would change
 *   npx tsx scripts/enrich-ben.ts --apply         · writes
 *   npx tsx scripts/enrich-ben.ts --limit 5       · first N listings
 *
 * The AccessTrade datafeed gives ONE image and a `desc` that is a copy of the product name, so the
 * 258 imported rows landed with a single photo and a description that repeats the title. The
 * merchant's own page carries 2–6 gallery images and an attribute table. This walks the listings,
 * reads those two things, and fills in what the feed could not.
 *
 * ⛔ FACTS, NOT THE MERCHANT'S PROSE. Only the attribute table is read; the descriptions are
 * composed by us from those values (src/lib/merchant-specs.ts). The page's own marketing copy is
 * deliberately left alone — reproducing it would be republishing their writing, and it sells their
 * shop rather than describing the product.
 *
 * ⚠️ ROBOTS CHECKED. ben.com.vn's robots.txt disallows /gio-hang, /thanh-toan, /quan-tri, /Manage,
 * /Account/* and /Products/* — carts, checkout and admin. Product detail pages are not disallowed.
 * Requests are serialised at a low concurrency with a delay, and identify themselves.
 */

const APPLY = process.argv.includes('--apply')
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = Number(arg('limit') ?? 0)
const CONCURRENCY = Number(arg('concurrency') ?? 3)
const MERCHANT = 'BỀN COMPUTER'
const UA = 'Mozilla/5.0 (compatible; eno.vn catalogue enrichment; +https://eno.vn)'
/** Feed image + up to this many from the page. Six photos is already more than most cards show. */
const MAX_IMAGES = 6

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from('listings') : null
const hostImage = makeImageHost({ storage, storageUrl: storageUrl ?? '', bucket: 'listings' })

/**
 * The merchant's own URL, out of the AccessTrade deep link.
 * ⚠️ THE LISTING DOES NOT STORE THE MERCHANT URL — only `affiliateUrl`, which is
 * `go.isclix.com/deep_link/<id>?url=<encoded merchant url>`. Reading it back out is what lets this
 * run without re-fetching the feed, and it is also the only mapping that is guaranteed correct:
 * it is the exact link the listing already points at.
 */
function merchantUrl(affiliateUrl: string | null): string | null {
  if (!affiliateUrl) return null
  try {
    const inner = new URL(affiliateUrl).searchParams.get('url')
    if (!inner) return null
    const u = new URL(inner)
    return u.hostname.endsWith('ben.com.vn') ? u.toString() : null
  } catch { return null }
}

/** Vietnamese-specific letters. Used only to decide whether a title needs translating at all. */
const VIETNAMESE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i

/**
 * An English title, for a listing whose title is Vietnamese.
 *
 * ⚠️ ONLY WHEN THE TITLE IS ACTUALLY VIETNAMESE. Half this catalogue is already English
 * ("(BALO) LENOVO 15.6 Inch Laptop Backpack B210") and running that through a translator can only
 * make it worse. The diacritic test is what separates the two.
 * ⛔ THE VIETNAMESE ORIGINAL IS KEPT IN `titleVi`, NEVER OVERWRITTEN. `title` is the base the app
 * falls back to and `titleVi` is what a Vietnamese reader sees — so the translation goes in `title`
 * and the merchant's own wording stays authoritative for the audience that reads it.
 * ⚠️ FAILS TO null, and the caller then leaves the title exactly as it is. A missing translation is
 * a listing that reads as it did yesterday; a bad one is a listing that lies about the product.
 */
async function translateTitle(text: string): Promise<string | null> {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY
  if (!key || !VIETNAMESE.test(text)) return null
  try {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'vi', target: 'en', format: 'text' }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const j = await res.json() as { data?: { translations?: { translatedText?: string }[] } }
    const out = j.data?.translations?.[0]?.translatedText?.trim()
    return out && out !== text ? out : null
  } catch { return null }
}

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item'

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${MERCHANT}${LIMIT ? ` (first ${LIMIT})` : ''}\n`)

  const seller = await db.seller.findFirst({ where: { name: MERCHANT }, select: { id: true } })
  if (!seller) { console.error(`storefront "${MERCHANT}" not found — run the import first`); process.exit(1) }

  const listings = await db.listing.findMany({
    where: { sellerId: seller.id },
    select: { id: true, title: true, titleVi: true, description: true, images: true, affiliateUrl: true },
    orderBy: { title: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  })
  console.log(`${listings.length} listings\n`)

  let enriched = 0, imagesAdded = 0, described = 0, translated = 0, noPage = 0, failed = 0
  let done = 0

  const work = listings.map((l) => async () => {
    const url = merchantUrl(l.affiliateUrl)
    if (!url) { noPage++; return }
    let html = ''
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) { failed++; return }
      html = await res.text()
    } catch { failed++; return }

    const gallery = parseGallery(html)
    const specs = parseSpecs(html)
    const en = composeDescription(specs, { merchant: MERCHANT, lang: 'en' })
    const vi = composeDescription(specs, { merchant: MERCHANT, lang: 'vi' })

    let current: string[] = []
    try { current = JSON.parse(l.images || '[]') } catch { current = [] }

    /**
     * ⚠️ THE EXISTING IMAGE STAYS FIRST. It is the feed's own primary shot and is already hosted and
     * watermarked; re-hosting it would spend an upload to get the same picture with a new URL, and
     * changing the cover of 258 live cards is not what "more images" asked for.
     */
    const want = Math.max(0, MAX_IMAGES - current.length)
    const extras: string[] = []
    if (want > 0 && APPLY) {
      for (const src of gallery.slice(0, want + 1)) {
        const hosted = await hostImage(src, slugify(l.title))
        if (hosted) extras.push(hosted)
        if (extras.length >= want) break
      }
    } else if (want > 0) {
      extras.push(...gallery.slice(0, want).map((g) => `(would host) ${g.split('/').pop()}`))
    }

    const enTitle = await translateTitle(l.title)

    const data: Record<string, unknown> = {}
    if (extras.length && APPLY) data.images = JSON.stringify([...current, ...extras])

    /**
     * ⛔ ONLY OVERWRITE COPY THE IMPORTER WROTE, NEVER COPY A HUMAN DID. The feed sets
     * `description` to a duplicate of the product name, which is the state every one of these 258
     * rows landed in — so "description is still the title" is a reliable signature of untouched
     * machine copy. Without this the script is a loaded gun: a second run months from now would
     * silently destroy any description someone had since written by hand. A reviewer named it, and
     * it is the difference between a re-runnable job and a one-shot.
     * ⚠️ It also makes the script IDEMPOTENT for the good case: once we have written our own
     * composed description, `description !== title` and a re-run leaves it alone.
     */
    const untouchedCopy = !l.description || l.description.trim() === l.title.trim()
    if (en && untouchedCopy) data.description = en
    if (vi && untouchedCopy) data.descriptionVi = vi

    /**
     * ⛔ THE VIETNAMESE ORIGINAL IS WRITTEN ONCE AND NEVER AGAIN. `titleVi` is only set while it is
     * still a copy of `title` — i.e. the importer's placeholder. If the two already differ, someone
     * (or an earlier run) has established a real Vietnamese title and this must not touch it.
     * ⚠️ `translateTitle` already declines a title with no Vietnamese diacritics, so a second run
     * cannot re-translate an English title either — but relying on that alone would make the safety
     * of a write depend on a heuristic elsewhere in the file.
     */
    const viTitleIsPlaceholder = !l.titleVi || l.titleVi.trim() === l.title.trim()
    if (enTitle && viTitleIsPlaceholder) { data.title = enTitle; data.titleVi = l.title }

    if (Object.keys(data).length) {
      if (APPLY) await db.listing.update({ where: { id: l.id }, data })
      enriched++
      if (extras.length) imagesAdded += extras.length
      if (en) described++
      if (enTitle) translated++
    }

    done++
    if (done % 20 === 0 || done === listings.length) {
      process.stdout.write(`\r  ${done}/${listings.length}  enriched=${enriched} images=${imagesAdded} described=${described} translated=${translated} noPage=${noPage} failed=${failed}   `)
    }
    // Polite: a real person browsing does not open three pages a second, and this is the merchant
    // whose catalogue we are selling.
    await new Promise((r) => setTimeout(r, 400))
  })

  for (let i = 0; i < work.length; i += CONCURRENCY) {
    await Promise.all(work.slice(i, i + CONCURRENCY).map((fn) => fn()))
  }

  console.log(`\n\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${enriched} enriched · ${imagesAdded} images · ${described} described · ${translated} titles translated · ${noPage} without a page · ${failed} fetch failures`)

  if (!APPLY && listings.length) {
    const sample = listings[0]
    const url = merchantUrl(sample.affiliateUrl)
    if (url) {
      const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text()
      const specs = parseSpecs(html)
      console.log(`\nsample — ${sample.title.slice(0, 60)}`)
      console.log(`  images now ${JSON.parse(sample.images || '[]').length}, page has ${parseGallery(html).length}`)
      console.log(`  EN: ${composeDescription(specs, { merchant: MERCHANT, lang: 'en' })?.slice(0, 150) ?? '(none)'}`)
      console.log(`  VI: ${composeDescription(specs, { merchant: MERCHANT, lang: 'vi' })?.slice(0, 150) ?? '(none)'}`)
    }
  }
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
