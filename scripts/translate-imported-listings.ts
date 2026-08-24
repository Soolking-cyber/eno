/**
 * Give feed-imported listings a real English title/description, keeping the Vietnamese original.
 *
 *   npx tsx scripts/translate-imported-listings.ts --seller CellphoneS           # DRY RUN + cost
 *   npx tsx scripts/translate-imported-listings.ts --seller CellphoneS --apply
 *
 * ⛔ THE IMPORTER PUT VIETNAMESE IN `title`, WHICH IS THE PRIMARY/ENGLISH SLOT. The app's
 * convention is `title` = primary, `titleVi` = Vietnamese, chosen by LocalizedTitle; writing the
 * merchant's Vietnamese name into `title` and leaving `titleVi` null means an English reader sees
 * Vietnamese and the language switch does nothing. This moves the original into `titleVi` and puts
 * the translation where the app expects it. Same for description ↔ descriptionVi.
 *
 * ⚠️ ONLY TEXT THAT IS ACTUALLY VIETNAMESE IS SENT. Half these titles are already English product
 * names ("iPhone 15 Pro Max 256GB") — translating those spends money to have Google hand back a
 * mangled version of a model number. The diacritic test is cheap and decides per string.
 *
 * ⚠️ IDEMPOTENT: a row that already has titleVi is skipped, so re-runs cost nothing.
 */
import 'dotenv/config'
import { db } from '../src/lib/db'

const KEY = process.env.GOOGLE_TRANSLATE_API_KEY
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const SELLER = arg('seller')
if (!SELLER) { console.error('--seller <name> required'); process.exit(1) }
if (APPLY && !KEY) { console.error('GOOGLE_TRANSLATE_API_KEY required to apply'); process.exit(1) }

/** Vietnamese-specific letters. Latin text without any of these is not Vietnamese prose. */
const VI_RE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i
const isVietnamese = (s: string) => VI_RE.test(s)

/** Google Translate v2. Batched — the endpoint takes many `q` per call, and 9.7k round trips would
 *  take longer than the translation itself. */
async function translate(texts: string[], label: string): Promise<string[]> {
  const out: string[] = []
  /**
   * ⚠️ 50 PER CALL AND A PAUSE BETWEEN CALLS — Google returns "User Rate Limit Exceeded" long
   * before the per-project quota if batches are fired back to back. Measured: 100-string batches
   * with no delay failed partway through 8,038 titles. The retry is exponential because a rate
   * limit that just tripped will trip again immediately.
   */
  const BATCH = 50
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    let done = false
    for (let attempt = 0; attempt < 6 && !done; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
      const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: batch, source: 'vi', target: 'en', format: 'text' }),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) {
        const j = await res.json() as { data: { translations: { translatedText: string }[] } }
        out.push(...j.data.translations.map((t) => t.translatedText))
        done = true
      } else if (res.status === 403 || res.status === 429) {
        if (attempt === 5) throw new Error(`rate limited after 6 attempts at ${label} ${i}`)
      } else {
        throw new Error(`translate: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
      }
    }
    await new Promise((r) => setTimeout(r, 250))
    if ((i / BATCH) % 20 === 0) console.log(`    ${label}: ${Math.min(i + BATCH, texts.length)}/${texts.length}`)
  }
  return out
}

async function main() {
  const seller = await db.seller.findFirst({ where: { name: SELLER }, select: { id: true, name: true } })
  if (!seller) { console.error(`no storefront "${SELLER}"`); process.exit(1) }

  /**
   * ⛔ KEYED ON "THE PRIMARY SLOT IS STILL VIETNAMESE", NOT ON titleVi BEING NULL. The importer
   * writes titleVi on every run, so a null check would mark every row done after the first import
   * and never translate anything. Worse, if a refresh ever did put Vietnamese back into `title`,
   * a null check would refuse to repair it. Asking the actual question — is the English slot
   * still Vietnamese? — is self-healing and costs one extra scan.
   */
  const all = await db.listing.findMany({
    where: { sellerId: seller.id },
    select: { id: true, title: true, description: true, titleVi: true, descriptionVi: true },
  })
  const rows = all.filter((r) => isVietnamese(r.title) || isVietnamese(r.description))
  console.log(`${seller.name}: ${all.length} listings, ${rows.length} still showing Vietnamese in the English slot`)

  const needTitle = rows.filter((r) => isVietnamese(r.title))
  const needDesc = rows.filter((r) => isVietnamese(r.description))
  const chars = needTitle.reduce((n, r) => n + r.title.length, 0) + needDesc.reduce((n, r) => n + r.description.length, 0)
  console.log(`  Vietnamese titles: ${needTitle.length}, descriptions: ${needDesc.length}`)
  console.log(`  ${chars.toLocaleString()} chars -> about $${(chars / 1_000_000 * 20).toFixed(2)} at $20/M`)
  console.log(`  ${all.length - rows.length} listings are already fully English and are NOT sent`)

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }

  const titlesEn = needTitle.length ? await translate(needTitle.map((r) => r.title), 'titles') : []
  const descsEn = needDesc.length ? await translate(needDesc.map((r) => r.description), 'descriptions') : []
  const tMap = new Map(needTitle.map((r, i) => [r.id, titlesEn[i]]))
  const dMap = new Map(needDesc.map((r, i) => [r.id, descsEn[i]]))

  let n = 0
  for (const r of rows) {
    const en = tMap.get(r.id), den = dMap.get(r.id)
    // A row with nothing Vietnamese still gets titleVi set to its own title, so the idempotency
    // check above skips it next time instead of re-examining it forever.
    await db.listing.update({
      where: { id: r.id },
      data: {
        // Keep the original where the importer puts it, in case this row predates that change.
        ...(r.titleVi ? {} : { titleVi: r.title }),
        ...(r.descriptionVi ? {} : { descriptionVi: r.description }),
        ...(en ? { title: en } : {}),
        ...(den ? { description: den } : {}),
      },
    })
    n++
    if (n % 500 === 0) console.log(`  ${n}/${rows.length}`)
  }
  console.log(`\nAPPLIED: ${n} listings now bilingual`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
