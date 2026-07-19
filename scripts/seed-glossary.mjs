// Seed the curated, native-reviewed marketplace glossary (scripts/glossary-data.json,
// from the 2026-07-06 i18n audit — 3 language review panels) into the Translation
// DB cache, OVERWRITING wrong machine translations (e.g. Property → ru "Свойства").
// Same hash scheme as src/lib/translate.ts (sha1 of the EN source). Idempotent.
// Keep in sync with TR_OVERRIDES in src/lib/i18n/glossary.ts.
//
// Run:  cd /Users/mk1e3/eno.vn && set -a; . ./.env; set +a; node scripts/seed-glossary.mjs
import pg from 'pg'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

async function main() {
  const entries = JSON.parse(readFileSync(new URL('./glossary-data.json', import.meta.url), 'utf8'))
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL })
  await c.connect()
  let up = 0
  for (const e of entries) {
    const hash = sha1(e.en)
    for (const [target, value] of Object.entries(e.translations)) {
      if (!value) continue
      await c.query(
        `insert into "Translation" (id, hash, target, value)
         values ($1, $2, $3, $4)
         on conflict (hash, target) do update set value = excluded.value`,
        [`gls_${hash.slice(0, 8)}_${target}`, hash, target, value],
      )
      up++
    }
  }
  // Sanity: the infamous wrong row must now be fixed.
  const check = await c.query(`select value from "Translation" where hash = $1 and target = 'ru'`, [sha1('Property')])
  console.log(`upserted ${up} rows across ${entries.length} terms · Property[ru] is now: ${check.rows[0]?.value}`)
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
