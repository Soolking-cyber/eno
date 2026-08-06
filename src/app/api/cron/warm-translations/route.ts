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
//
// ⚠️ WS6 — NOT MIGRATED, AND IT IS THE ONE CRON ROUTE THAT LOOKS LIKE IT SHOULD BE. Its five
// siblings (daily-reminders, price-stats, saved-search-alerts, video-gc, weekly-digest) carried a
// byte-identical `bearerOk()` guard and are now on `auth: 'cron'`. This one is NOT a sixth copy —
// it was written separately and differs in every failure branch:
//   · UNSET SECRET IS A 503, NOT A 401. `{"error":"not_configured"}` 503 here vs
//     `{"error":"forbidden"}` 401 there. Two different statuses and two different codes.
//   · THE 401 CODE IS DIFFERENT: `{"error":"unauthorized"}`, not `{"error":"forbidden"}`.
//   · IT COMPARES THE FULL `authorization` HEADER against `Bearer <secret>`, where the five
//     compare only the token. Same accept/reject decision in practice, different code.
// `auth: 'cron'` reproduces the five exactly, which means it necessarily gets all three of those
// wrong for this route — three response bodies and one status code. Nothing else is available
// either: public + no limiter + no JSON body means the wrapper's remaining options are all empty,
// so wrapping it while pinning the guard inline would be churn.
//
// The 503 is a real distinction worth keeping, not an inconsistency to be tidied away: it tells an
// operator "this deployment has no CRON_SECRET" (a config fault, retry later) rather than "your
// credentials are wrong" — which is exactly what you want to read in a cron log at 3am. Unifying
// the three codes is a wire change to a scheduler contract and belongs in the separate
// error-code-consolidation pass, with the caller changed alongside.
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
  // Top visitor languages — a mirror of EAGER_WARM_LANGS in translate.ts (KEEP IN SYNC).
  // The UI dictionary is warmed for ALL languages (small, stable, and the app chrome must
  // render fully in whatever language the visitor picked). LISTING CONTENT — titles and,
  // above all, long descriptions — is pre-warmed ONLY for these top languages; the rare
  // languages (km/ms/th/fr/hi) translate listing text ON-DEMAND at view time (the PDP
  // client-machine-translates any missing language, then it caches forever). Attribution
  // (docs/translation-cost.md) showed >54% of all translation spend was going to those 5
  // rare languages — mostly listing descriptions almost nobody reads in them — because this
  // cron eagerly translated every recent listing into all 11. On-demand covers the rare
  // reader for the cost of one first-view translate, instead of paying for the whole catalog
  // in languages that are never browsed.
  const LISTING_WARM_LANGS = new Set<Lang>(['vi', 'zh-Hans', 'ko', 'ja', 'ru'])
  const uiCorpus = Array.from(new Set(UI_STRINGS))
  const uiHashes = uiCorpus.map(sha1)

  // Listing text (title/description/location of recent active listings). Recent window + row
  // cap keep the sweep bounded on a big catalog; older listings age out of relevance anyway.
  const recent = await db.listing.findMany({
    where: { status: 'active', verified: true, postedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    select: { title: true, description: true, location: true },
    orderBy: { postedAt: 'desc' },
    take: 400,
  })
  const listingTexts = Array.from(new Set(recent.flatMap((l) => [l.title, l.description, l.location]).filter((t): t is string => !!t && t.trim().length > 0)))
  // Deduped ACROSS the UI set + listing text (a listing whose text equals a UI string must not
  // be translated or counted twice) — preserves the original single-corpus dedup for the warmed
  // languages; index alignment holds because each corpus is paired with its own hash array.
  const fullCorpus = Array.from(new Set([...uiCorpus, ...listingTexts]))
  const fullHashes = fullCorpus.map(sha1)
  const report: Record<string, { missing: number; healed: number }> = {}

  for (const lang of targets) {
    // UI dictionary for every language; listing content only for the top visitor languages.
    const corpus = LISTING_WARM_LANGS.has(lang) ? fullCorpus : uiCorpus
    const hashes = LISTING_WARM_LANGS.has(lang) ? fullHashes : uiHashes
    const have = new Set(
      (await db.translation.findMany({ where: { target: lang, hash: { in: hashes } }, select: { hash: true } })).map((r) => r.hash),
    )
    const missing = corpus.filter((s, i) => !have.has(hashes[i]))
    let healed = 0
    if (missing.length > 0) {
      // translateBatch writes rows to the DB itself; a hard provider failure maps
      // to source-text passthrough WITHOUT a DB write, so a failed day simply
      // retries tomorrow. Cap per run to bound provider spend.
      const chunkTexts = missing.slice(0, 1500)
      const out = await translateBatch(chunkTexts, lang, { source: 'warm-cron' }) // ordered, index-aligned
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
