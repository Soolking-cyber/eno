// One-off: publish the pre-existing verified=false ("Held") listings that pass the NEW
// publish rules (non-restricted seller + ≥1 photo + clean text). Restricted / no-photo /
// contact-or-banned-text listings stay hidden — consistent with the new model. Uses the
// SAME guard functions as the live post path.
//   set -a; . ./.env; set +a; npx tsx scripts/publish-held.ts [--apply]
import pg from 'pg'
import { containsPhoneNumber } from '../src/lib/phone'
import { containsContactInfo, findBannedWord } from '../src/lib/publish-guard'

const APPLY = process.argv.includes('--apply')

;(async () => {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()

  const { rows } = await c.query(
    `SELECT l.id, l.title, l.description, l.images, s."trustTier"
     FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId"
     WHERE l.verified = false AND l.status = 'active'`,
  )

  const toPublish: string[] = []
  const skip = { restricted: 0, noPhoto: 0, content: 0 }
  for (const r of rows) {
    if (r.trustTier === 'restricted') { skip.restricted++; continue }
    let imgs: unknown[] = []
    try { imgs = JSON.parse(r.images || '[]') } catch { /* treat as none */ }
    if (!Array.isArray(imgs) || imgs.length < 1) { skip.noPhoto++; continue }
    const txt = `${r.title} ${r.description || ''}`
    if (containsPhoneNumber(r.title) || containsPhoneNumber(r.description) || containsContactInfo(txt) || findBannedWord(txt)) { skip.content++; continue }
    toPublish.push(r.id)
  }

  console.log(`held(active)=${rows.length}  →  WOULD PUBLISH=${toPublish.length}  |  stays hidden: restricted=${skip.restricted} noPhoto=${skip.noPhoto} content=${skip.content}`)
  if (APPLY && toPublish.length) {
    const res = await c.query(`UPDATE "Listing" SET verified = true WHERE id = ANY($1::text[])`, [toPublish])
    console.log(`PUBLISHED ${res.rowCount} listing(s).`)
  } else if (!APPLY) {
    console.log('(dry run — re-run with --apply to publish)')
  }
  await c.end()
})()
