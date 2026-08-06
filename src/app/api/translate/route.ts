import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { translateBatch, uncachedStats, LANGS, type Lang } from '@/lib/translate'
import { rateLimit, kv } from '@/lib/ratelimit'

// Global daily ceiling on BILLABLE characters through this public endpoint. The per-request
// (30k chars) and per-IP guards bound ONE caller; this bounds ALL of them together — worst
// case ≈ $20/day at Google's $20/M chars instead of unbounded. Organic misses are tiny
// (listing text is pre-warmed at post time; the UI dictionary is fully cached), and the
// nightly warm-translations cron doesn't go through this route at all.
const DAILY_CHAR_BUDGET = 1_000_000

/** Charge `chars` against today's global budget. True = proceed. Fail-CLOSED on a backend
 *  error — consistent with the strict per-IP limiter below: no accounting, no paid calls. */
async function chargeCharBudget(chars: number): Promise<boolean> {
  try {
    const key = `translate:chars:${new Date().toISOString().slice(0, 10)}`
    const total = await kv.incrby(key, chars, 2 * 24 * 60 * 60)
    return total <= DAILY_CHAR_BUDGET
  } catch {
    return false
  }
}

// ⚠️ WS6 — NOT MIGRATED, and all four wrapper options would be empty, so route() buys nothing.
// `auth: 'public'` (no caller at all — this serves the UI dictionary to guests). The limiter cannot
// be hoisted: it fires only when `newCount > 0`, i.e. after the body is parsed AND priced by
// uncachedStats(), so a request of purely cached strings must never touch it — that is the fix
// behind the "DEGRADE, never refuse" note below. No `body:` schema either: the 400s here carry
// PROSE, not codes (`"Expected { texts: string[], target: Lang }"`, `"Too many texts in one
// request"`), which cannot be expressed as an ApiErrorCode and must not be tidied into one. The
// catch-all 500 is likewise `{"error":"Translation failed"}`, not `internal_error`.
export async function POST(req: Request) {
  // Public + triggers PAID translation on a cache miss → cross-request IP throttle
  // so the per-request size guard below can't be looped to drain the budget.
  const ip = clientIp(req)
  try {
    const body = await req.json()
    const texts: unknown = body?.texts
    const target: unknown = body?.target

    if (!Array.isArray(texts) || typeof target !== 'string' || !LANGS.includes(target as Lang)) {
      return NextResponse.json({ error: 'Expected { texts: string[], target: Lang }' }, { status: 400 })
    }

    const list = texts as string[]
    // Anti-DoS: bound the raw payload. Generous, so the app's own large batches
    // (the ~555-string UI dictionary, busy listing pages) pass through.
    if (list.length > 1500) {
      return NextResponse.json({ error: 'Too many texts in one request' }, { status: 400 })
    }

    // Cost guard: this public endpoint can trigger a PAID translation on a cache
    // miss — but cache hits are free (a string is billed once, then cached
    // forever). So bound only the BILLABLE (uncached) work, not total size: the
    // full UI dictionary and repeat listing views (all cache hits) go straight
    // through, while a request asking for a large batch of brand-new strings is
    // rejected. This is what fixes the UI dictionary fetch, which was a single
    // request of all ~555 strings (all cached) being wrongly rejected by size.
    const { count: newCount, chars: newChars } = await uncachedStats(list, target as Lang)
    if (newCount > 250 || newChars > 30000) {
      return NextResponse.json({ error: 'Too many new texts in one request' }, { status: 400 })
    }
    // Rate-limit ONLY billable (uncached) requests — and strictly, so a Redis outage
    // can't be looped to drain the paid translation budget. Pure cache hits (the UI
    // dictionary, repeat views) cost $0 and ALWAYS serve, even when Redis is down, so
    // the translated UI never breaks on a limiter outage.
    if (newCount > 0) {
      // 6 billable requests/min/IP (was 60 — at 30k chars each that allowed ~$36/min from a
      // single IP). Real users trigger at most a couple of misses per page; cache hits below
      // stay unlimited so the translated UI never throttles.
      const rl = await rateLimit('translate', ip, 6, '1 m', { strict: true })
      // Budget only charged when the limiter passed (&& short-circuits).
      const allowed = rl.success && (await chargeCharBudget(newChars))
      if (!allowed) {
        // DEGRADE, never refuse (owner report 2026-07-23): a 429 here used to blank a
        // whole 100-string UI-dictionary chunk to English — ONE unwarmed string made
        // the chunk billable, and the free cache hits died with the refusal. Serve the
        // hits + source passthrough for the misses: spends nothing (no provider call),
        // and partial:true tells the client to seed but NOT persist, so the dict
        // self-heals once the nightly warm covers the new strings.
        const translations = await translateBatch(list, target as Lang, { cachedOnly: true })
        return NextResponse.json({ translations, partial: true })
      }
    }

    const translations = await translateBatch(list, target as Lang, { source: 'api' })
    return NextResponse.json({ translations })
  } catch (err) {
    console.error('[api/translate]', err)
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
  }
}
