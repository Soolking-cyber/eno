import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { translateBatch, LANGS, type Lang } from '@/lib/translate'
import { UI_STRINGS } from '@/generated/ui-strings'
import { logError } from '@/lib/log'
import { route } from '@/lib/api/handler'

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
//
// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY, which is all this route had. `auth: 'admin'` is the
// same getAdmin() and answers a non-admin with `{"error":"Forbidden"}` 403, capital F. A GET has no
// body, so `body:` is meaningless; no rate limit existed and adding one would invent a 429 branch
// — note that ?probe=1 bills ~30 characters of translation, so if a limiter is ever wanted it
// belongs on that branch specifically, which route()'s static option could not express anyway.
// ⚠️ `'admin'` RESOLVES NO PROFILE. An earlier draft of this header said it follows getAdmin()
// with getCurrentProfile() and called the extra Profile read an accepted cost. It did, and the
// cost turned out not to be acceptable anywhere: no admin handler reads ctx.profile or
// ctx.userId, the call made read-only admin GETs perform a presence-heartbeat WRITE, and on a
// first-ever call it runs ensureProfile()'s irreversible guest-Seller auto-claim. It was removed
// from the wrapper in this same commit; getAdmin() is Supabase-auth only and touches no DB.
//
// Branches: non-admin → 403 `{"error":"Forbidden"}` · no ?probe=1 → 200
// `{strings,providerConfigured,coverage}` · ?probe=1 → 200 the same plus `probe:{ok,ms,result}`.
// The sentinel cleanup already swallows its own failure via logError.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: the per-language `db.translation.count` loop and
// `translateBatch()` are unwrapped, so a DB outage or a provider throw used to reach Next's default
// 500 — and a provider throw is the realistic case here, since ?probe=1 exists precisely to be run
// when translation is suspected broken. Those now return `{"error":"internal_error"}` 500, logged
// with an `op`. An improvement (structured, and never the provider's exception text, which can
// carry the API key in a URL), but a wire change on that failure path.
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')

export const GET = route({ auth: 'admin' }, async ({ req }) => {
  const targets = LANGS.filter((l): l is Lang => l !== 'en' && l !== 'vi') // vi is hand-authored
  const hashes = UI_STRINGS.map(sha1)
  const coverage: Record<string, { have: number; total: number; pct: number }> = {}
  for (const lang of targets) {
    const have = await db.translation.count({ where: { target: lang, hash: { in: hashes } } })
    coverage[lang] = { have, total: UI_STRINGS.length, pct: Math.round((have / UI_STRINGS.length) * 1000) / 10 }
  }

  const providerConfigured = !!(process.env.AZURE_TRANSLATOR_KEY || process.env.GOOGLE_TRANSLATE_API_KEY)
  const base = { strings: UI_STRINGS.length, providerConfigured, coverage }

  if (new URL(req.url).searchParams.get('probe') !== '1') return base

  // Live probe: a timestamped sentence is never cached, so a translated result
  // proves the provider works FROM THIS deployment (referer-restricted keys fail
  // server-side even when set — the 2026-07-06 outage).
  const sentinel = `The translation provider health probe ${Date.now()}`
  const t0 = Date.now()
  const [out] = await translateBatch([sentinel], 'ru', { source: 'health' })
  // translateBatch caches successful results — delete the junk probe row.
  await db.translation.deleteMany({ where: { hash: sha1(sentinel), target: 'ru' } }).catch((e) => logError(e, { op: 'i18nHealth.clearSentinel' }))
  return {
    ...base,
    probe: { ok: out !== sentinel, ms: Date.now() - t0, result: out.slice(0, 80) },
  }
})
