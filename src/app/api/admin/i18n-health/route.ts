import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { translateBatch, LANGS, type Lang } from '@/lib/translate'
import { UI_STRINGS } from '@/generated/ui-strings'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Admin-only i18n health: per-language UI-dictionary coverage + provider status —
// the one-glance answer to "is every language fully served right now?".
//   GET /api/admin/i18n-health           → coverage % per language
//   GET /api/admin/i18n-health?probe=1   → + a LIVE provider probe (translates one
//     uncached string, ~30 chars billed) proving the lazy path works in THIS env.
// Sister endpoint to /api/admin/ai-health. The daily self-heal cron
// (/api/cron/warm-translations) keeps coverage at 100%; if a language shows a gap
// here for more than a day, the provider env (AZURE_TRANSLATOR_* /
// GOOGLE_TRANSLATE_API_KEY without referer restriction) is the first suspect.
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')

export async function GET(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const targets = LANGS.filter((l): l is Lang => l !== 'en' && l !== 'vi') // vi is hand-authored
  const hashes = UI_STRINGS.map(sha1)
  const coverage: Record<string, { have: number; total: number; pct: number }> = {}
  for (const lang of targets) {
    const have = await db.translation.count({ where: { target: lang, hash: { in: hashes } } })
    coverage[lang] = { have, total: UI_STRINGS.length, pct: Math.round((have / UI_STRINGS.length) * 1000) / 10 }
  }

  const providerConfigured = !!(process.env.AZURE_TRANSLATOR_KEY || process.env.GOOGLE_TRANSLATE_API_KEY)
  const base = { strings: UI_STRINGS.length, providerConfigured, coverage }

  if (new URL(req.url).searchParams.get('probe') !== '1') return NextResponse.json(base)

  // Live probe: a timestamped sentence is never cached, so a translated result
  // proves the provider works FROM THIS deployment (referer-restricted keys fail
  // server-side even when set — the 2026-07-06 outage).
  const sentinel = `The translation provider health probe ${Date.now()}`
  const t0 = Date.now()
  const [out] = await translateBatch([sentinel], 'ru', { source: 'health' })
  // translateBatch caches successful results — delete the junk probe row.
  await db.translation.deleteMany({ where: { hash: sha1(sentinel), target: 'ru' } }).catch((e) => logError(e, { op: 'i18nHealth.clearSentinel' }))
  return NextResponse.json({
    ...base,
    probe: { ok: out !== sentinel, ms: Date.now() - t0, result: out.slice(0, 80) },
  })
}
