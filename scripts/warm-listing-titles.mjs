// Pre-warm the Translation cache with one seller's listing TITLES, so a visitor reading the site in
// Chinese, Korean, Japanese or Russian gets the catalogue in their language with no flash and no
// per-request translation.
//
//   node scripts/warm-listing-titles.mjs --seller SuperSports                 # DRY RUN + cost
//   node scripts/warm-listing-titles.mjs --seller SuperSports --apply
//   node scripts/warm-listing-titles.mjs --seller SuperSports --langs zh-Hans,ko --apply
//
// Run with the env loaded:  set -a; . ./.env; set +a; node scripts/warm-listing-titles.mjs …
//
// ⛔ AZURE, NOT GOOGLE, AND THAT IS A PRICE DECISION. Azure Translator's free F0 tier is 2M
// chars/month; Google Translation v2 is $20/M with ~$44 of credit left on the account. SuperSports'
// 5,978 English titles are ~284k chars per language — four languages is 1.14M chars, i.e. FREE on
// Azure and ~$23 on Google. `scripts/prewarm-translations.mjs` made the same call for the UI string
// set, for the same reason. `--provider google` is there for a language Azure handles badly.
//
// ⚠️ ONLY MISSING ROWS ARE FILLED. The cache is keyed sha1(source text) + target and is permanent —
// re-running this costs nothing, which is the whole point ("make sure we dont go through them
// again"). Nothing here overwrites a translation that already exists.
//
// ⚠️ TITLES ONLY, DELIBERATELY. Descriptions are 4.8M chars for this one catalogue (~$860 across
// nine languages); they translate on demand through /api/translate, which has its own per-IP,
// per-request and global daily budget, and they are cached for ever once read. Titles are what a
// browsing visitor sees a hundred of per page; a description is one page at a time.
import pg from 'pg'
import crypto from 'node:crypto'

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const SELLER = arg('seller')
const PROVIDER = arg('provider') ?? 'azure'
// The app's own eager set minus `vi` (these listings carry merchant Vietnamese already) and minus
// `en` (the title IS English). src/lib/translate.ts: EAGER_WARM_LANGS.
const LANGS = (arg('langs') ?? 'zh-Hans,ko,ja,ru').split(',').map((s) => s.trim()).filter(Boolean)
const MAX_CHARS = Number(arg('max-chars') ?? 1_500_000)
if (!SELLER) { console.error('--seller <name> required'); process.exit(1) }

const AZ_KEY = process.env.AZURE_TRANSLATOR_KEY
const AZ_REGION = process.env.AZURE_TRANSLATOR_REGION || 'southeastasia'
const G_KEY = process.env.GOOGLE_TRANSLATE_API_KEY
if (APPLY && PROVIDER === 'azure' && !AZ_KEY) { console.error('AZURE_TRANSLATOR_KEY missing'); process.exit(1) }
if (APPLY && PROVIDER === 'google' && !G_KEY) { console.error('GOOGLE_TRANSLATE_API_KEY missing'); process.exit(1) }

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

async function azure(texts, target) {
  const res = await fetch(
    `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=${encodeURIComponent(target)}`,
    { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': AZ_KEY, 'Ocp-Apim-Subscription-Region': AZ_REGION, 'Content-Type': 'application/json' },
      body: JSON.stringify(texts.map((text) => ({ text }))) },
  )
  if (!res.ok) throw new Error(`azure ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).map((d) => d.translations?.[0]?.text)
}

/**
 * ⚠️ GOOGLE v2 DOES NOT KNOW `zh-Hans` (a reviewer's catch — it answers HTTP 400). The app's own
 * language roster uses BCP-47 subtags; Google v2 wants its own older codes. Azure accepts both, so
 * this map only applies on the Google path, and the CACHE KEY stays the app's code either way — a
 * row written under `zh-CN` would never be read back.
 */
const GOOGLE_CODE = { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' }

async function google(texts, target) {
  // ⚠️ `source: 'en'` ALWAYS, never auto-detect. The Tiki title backfill (2026-09-15) let Google
  // detect, and it "translated" EliteBook, Sakos and Gold as if they were words — 830 rows had to
  // be redone. These titles are the merchant's English; say so.
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${G_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'en', target: GOOGLE_CODE[target] ?? target, format: 'text' }),
  })
  if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  return (json.data?.translations ?? []).map((t) => t.translatedText)
}

const translate = PROVIDER === 'google' ? google : azure

/** Latin-script check: a title that is still Vietnamese must not be shipped to an EN→xx engine. */
const VI_RE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i

async function main() {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()
  const { rows: sellers } = await c.query('select id, name from "Seller" where name = $1', [SELLER])
  if (!sellers.length) { console.error(`no seller named "${SELLER}"`); process.exit(1) }
  const { rows } = await c.query(
    `select distinct title from "Listing" where "sellerId" = $1 and status = 'active' and title <> ''`,
    [sellers[0].id],
  )
  const all = rows.map((r) => r.title)
  const titles = all.filter((t) => !VI_RE.test(t))
  console.log(`${SELLER}: ${all.length} distinct active titles, ${titles.length} English (${all.length - titles.length} still Vietnamese — skipped)`)
  console.log(`provider: ${PROVIDER}   languages: ${LANGS.join(', ')}\n`)

  let totalNew = 0, totalChars = 0
  const plan = []
  for (const lang of LANGS) {
    const hashes = titles.map(sha1)
    const have = new Set((await c.query('select hash from "Translation" where target = $1 and hash = any($2)', [lang, hashes])).rows.map((r) => r.hash))
    const missing = titles.filter((t) => !have.has(sha1(t)))
    const chars = missing.reduce((n, t) => n + t.length, 0)
    plan.push({ lang, missing, chars })
    totalNew += missing.length
    totalChars += chars
    console.log(`  ${lang.padEnd(8)} ${String(missing.length).padStart(6)} missing  ${chars.toLocaleString().padStart(10)} chars`)
  }
  console.log(`\ntotal: ${totalNew} strings, ${totalChars.toLocaleString()} chars` +
    `  (Azure free tier is 2,000,000/month; at Google's $20/M this would be ~$${(totalChars / 1e6 * 20).toFixed(2)})`)
  // ⚠️ A CEILING THAT REFUSES RATHER THAN WARNS. The same guard translate-titles-google.ts carries:
  // a catalogue that quietly grew tenfold must not become a bill nobody approved.
  if (totalChars > MAX_CHARS) { console.error(`\n⛔ ${totalChars.toLocaleString()} chars exceeds --max-chars ${MAX_CHARS.toLocaleString()} — refusing. Re-measure before raising it.`); process.exit(1) }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await c.end(); return }

  for (const { lang, missing } of plan) {
    let done = 0, failed = 0
    // 90 strings per call: Azure's limit is 100 texts / 50k chars per request, Google's is
    // generous; 90 keeps both comfortable and a failure cheap.
    for (let i = 0; i < missing.length; i += 90) {
      const chunk = missing.slice(i, i + 90)
      try {
        const out = await translate(chunk, lang)
        const pairs = chunk.map((src, n) => [src, out[n]]).filter(([, v]) => typeof v === 'string' && v.trim())
        for (const [src, value] of pairs) {
          // ⚠️ ON CONFLICT DO NOTHING — a row written by a live page view between the SELECT above
          // and this INSERT is just as good as ours, and overwriting it would be the one thing this
          // script promises not to do.
          await c.query(
            `insert into "Translation" (id, hash, target, value, "createdAt") values (gen_random_uuid()::text, $1, $2, $3, now())
             on conflict (hash, target) do nothing`,
            [sha1(src), lang, value],
          )
        }
        done += pairs.length
      } catch (e) { failed += chunk.length; console.error(`  ${lang} chunk ${i}: ${e.message}`) }
      if (i % 900 === 0 || i + 90 >= missing.length) console.log(`  ${lang}: ${done + failed}/${missing.length}`)
    }
    console.log(`  ${lang}: ${done} written, ${failed} failed`)
  }
  await c.end()
  console.log('\nDone.')
}

main().catch((e) => { console.error(e); process.exit(1) })
