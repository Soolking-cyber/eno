// Pre-warm the Translation DB for the full harvested UI string set (ui-strings.ts)
// across all 9 machine-translated languages. Only fills rows that are MISSING —
// never overwrites existing values (so curated glossary rows from seed-glossary.mjs
// and prior good translations stay). Uses GOOGLE_TRANSLATE_API_KEY from .env
// directly (no dev server needed); same sha1 hash scheme as src/lib/translate.ts.
//
// Run:  cd /Users/mk1e3/eno.vn && set -a; . ./.env; set +a; node scripts/prewarm-translations.mjs
import pg from 'pg'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

// NOTE: the Google key is HTTP-referer-restricted → 403s for ANY server-side call
// (discovered 2026-07-06 — this also means prod's translate.ts can never use it;
// the app has been surviving on the Azure fallback). Use Azure here directly:
// free F0 tier (2M chars/mo), no referer restriction, same engine translate.ts uses.
const AZ_KEY = process.env.AZURE_TRANSLATOR_KEY
const AZ_REGION = process.env.AZURE_TRANSLATOR_REGION || 'southeastasia'
if (!AZ_KEY) { console.error('AZURE_TRANSLATOR_KEY missing'); process.exit(1) }
const LANGS = ['zh-Hans', 'ko', 'ja', 'ru', 'km', 'ms', 'th', 'fr', 'hi']
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

// ui-strings.ts is a TS module — extract the JSON array literal (after the `=`,
// NOT the first `[`: that's the `string[]` type annotation).
const tsSrc = readFileSync('src/generated/ui-strings.ts', 'utf8')
const eq = tsSrc.indexOf('= [')
const STRINGS = JSON.parse(tsSrc.slice(eq + 2, tsSrc.lastIndexOf(']') + 1))

async function translateChunk(texts, target) {
  const res = await fetch(
    `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=${encodeURIComponent(target)}`,
    {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': AZ_KEY, 'Ocp-Apim-Subscription-Region': AZ_REGION, 'Content-Type': 'application/json' },
      body: JSON.stringify(texts.map((t) => ({ text: t }))),
    },
  )
  if (!res.ok) throw new Error(`azure ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data.map((d) => d.translations?.[0]?.text)
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL })
  await c.connect()
  console.log(`strings: ${STRINGS.length} × ${LANGS.length} languages`)
  let totalNew = 0, totalChars = 0
  for (const lang of LANGS) {
    const hashes = STRINGS.map(sha1)
    const have = new Set(
      (await c.query(`select hash from "Translation" where target = $1 and hash = any($2)`, [lang, hashes])).rows.map((r) => r.hash),
    )
    const missing = STRINGS.filter((s, i) => !have.has(hashes[i]))
    if (missing.length === 0) { console.log(`${lang}: complete`); continue }
    let n = 0
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100)
      try {
        const out = await translateChunk(chunk, lang)
        for (let j = 0; j < chunk.length; j++) {
          const v = out[j]
          if (!v) continue
          await c.query(
            `insert into "Translation" (id, hash, target, value) values ($1, $2, $3, $4)
             on conflict (hash, target) do nothing`,
            [`pw_${sha1(chunk[j]).slice(0, 10)}_${lang}`, sha1(chunk[j]), lang, v],
          )
          n++
          totalChars += chunk[j].length
        }
      } catch (e) {
        console.error(`  ${lang} chunk ${i}: ${e.message}`)
      }
      await new Promise((r) => setTimeout(r, 150)) // pace the API
    }
    totalNew += n
    console.log(`${lang}: +${n} rows (${missing.length} were missing)`)
  }
  console.log(`done: ${totalNew} new rows, ~${Math.round(totalChars / 1000)}k chars billed`)
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
