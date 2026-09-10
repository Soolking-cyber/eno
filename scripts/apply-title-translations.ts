/**
 * Write the Gemini title translations produced by retranslate-titles-gemini.ts into `Listing.title`.
 *
 *   npx tsx scripts/apply-title-translations.ts --file done.json           # DRY RUN
 *   npx tsx scripts/apply-title-translations.ts --file done.json --apply
 *
 * ⛔ RUN THIS ON THE BOX, next to the database. The translation half runs on the operator's laptop
 * (that is where `agy` is), and this half must not reach across an SSH tunnel that has already
 * killed one long-running import mid-write.
 *
 * ⚠️ IT ONLY EVER TOUCHES `title`. `titleVi` holds the merchant's own Vietnamese and is the source
 * of truth for every re-translation — including this one, which exists precisely because an
 * earlier model wrote nonsense into `title`. If `titleVi` were ever overwritten the originals
 * would be gone and no later pass could repair anything.
 *
 * ⚠️ AND IT VERIFIES THE VIETNAMESE STILL MATCHES BEFORE WRITING. Between the dump and the apply
 * a re-import can change a row; writing a translation of yesterday's title onto today's product
 * is the same mislabelling this pipeline is built to avoid, so a row whose `titleVi` has moved is
 * SKIPPED and reported rather than updated.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { db } from '../src/lib/db'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const FILE = arg('file')
const APPLY = process.argv.includes('--apply')
if (!FILE) { console.error('--file <done.json> required'); process.exit(1) }

type Done = { id: string; vi: string; en: string }

async function main() {
  const rows: Done[] = JSON.parse(readFileSync(FILE!, 'utf8'))
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} translations in ${FILE}\n`)

  let written = 0
  let moved = 0
  let identical = 0
  let missing = 0
  const samples: string[] = []

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const live = await db.listing.findMany({
      where: { id: { in: chunk.map((c) => c.id) } },
      select: { id: true, title: true, titleVi: true },
    })
    const byId = new Map(live.map((l) => [l.id, l]))
    for (const r of chunk) {
      const l = byId.get(r.id)
      if (!l) { missing++; continue }
      // The row must still be the product we translated.
      if (l.titleVi !== r.vi) { moved++; continue }
      if (l.title === r.en) { identical++; continue }
      if (samples.length < 6) samples.push(`  ${r.vi.slice(0, 44)}\n    was: ${l.title.slice(0, 44)}\n    now: ${r.en.slice(0, 44)}`)
      if (APPLY) {
        /**
         * ⛔ THE WRITE ITSELF MUST MATCH `titleVi`, not just the read above. Checking a snapshot
         * and then updating by id alone leaves a window in which a re-import changes the product
         * and yesterday's translation lands on it anyway — the mislabelling this whole pipeline
         * exists to avoid, reintroduced at the last step (codex, astra).
         */
        const { count } = await db.listing.updateMany({
          where: { id: r.id, titleVi: r.vi },
          data: { title: r.en },
        })
        if (count === 0) { moved++; continue }
      }
      written++
    }
    if (APPLY && (i + 200) % 2000 === 0) console.log(`  ${Math.min(i + 200, rows.length)}/${rows.length} …`)
  }

  console.log(samples.join('\n'))
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${written} titles ${APPLY ? 'updated' : 'would be updated'}`)
  console.log(`  ${identical} already correct, ${moved} changed underneath us (skipped), ${missing} no longer exist`)
  if (APPLY) console.log('\nNEXT: node scripts/purge-isr-listings.mjs   (PDP titles are baked into ISR pages)')
  await db.$disconnect()
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
