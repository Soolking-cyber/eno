import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { translateBatch, LANGS, type Lang } from '@/lib/translate'
import { UI_STRINGS } from '@/generated/ui-strings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ── i18n self-healing (daily) ─────────────────────────────────────────────────────
// Fills any MISSING Translation rows for the full harvested UI string set across
// every non-EN language — so a string that slipped past the lint gate / freshness
// check (or rows lost to a provider outage) heals automatically within a day
// instead of rendering English until someone runs a script. Never overwrites
// existing rows (curated glossary values stay). Also logs per-language coverage,
// making the Vercel cron logs the i18n health record.
//   Guarded by CRON_SECRET (Vercel attaches it as a Bearer header).
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  if (auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const targets = LANGS.filter((l): l is Lang => l !== 'en')
  const hashes = UI_STRINGS.map(sha1)
  const report: Record<string, { missing: number; healed: number }> = {}

  for (const lang of targets) {
    const have = new Set(
      (await db.translation.findMany({ where: { target: lang, hash: { in: hashes } }, select: { hash: true } })).map((r) => r.hash),
    )
    const missing = UI_STRINGS.filter((s, i) => !have.has(hashes[i]))
    let healed = 0
    if (missing.length > 0) {
      // translateBatch writes rows to the DB itself; a hard provider failure maps
      // to source-text passthrough WITHOUT a DB write, so a failed day simply
      // retries tomorrow. Cap per run to bound provider spend.
      const chunkTexts = missing.slice(0, 1500)
      const out = await translateBatch(chunkTexts, lang) // ordered, index-aligned
      healed = chunkTexts.reduce((n, t, i) => (out[i] && out[i] !== t ? n + 1 : n), 0)
    }
    report[lang] = { missing: missing.length, healed }
  }

  const totalMissing = Object.values(report).reduce((n, r) => n + r.missing, 0)
  const totalHealed = Object.values(report).reduce((n, r) => n + r.healed, 0)
  console.log('[cron/warm-translations]', JSON.stringify({ totalMissing, totalHealed, report }))
  // A large healed-count day means strings were shipping English — worth a look;
  // totalMissing >> totalHealed means the PROVIDER is failing (check env keys).
  return NextResponse.json({ ok: true, totalMissing, totalHealed, report })
}
