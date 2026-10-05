import 'server-only'
import { kv } from '@/lib/ratelimit'
import { EDITION } from '@/lib/edition'
import { appReviewGate } from '@/lib/app-review-gates'
import { logError } from '@/lib/log'
import { findSevereAbuse, type SevereCategory } from '@/lib/severe-abuse-words'

/**
 * THE USER-GENERATED-CONTENT FILTER — App Store Guideline 1.2 ("a method for filtering objectionable
 * material"), plan R5, behind the `ugc-safety` review gate. Gate OFF (the default) ⇒ nothing is scanned
 * and nothing is refused, on either site or app.
 *
 * Gate ON: a chat message (or an offer's note, or the first message that opens a thread), a seller review,
 * a help-centre comment and a help-centre post are REFUSED — the route answers 400
 * `objectionable_content` and writes nothing — when they contain a SEVERE term
 * (src/lib/severe-abuse-words.ts: slurs and hate speech, sexual content involving minors, sexual
 * solicitation, explicit threats of violence; owner decision, delegated 2026-10-05: severe only, never
 * general profanity). The client says why in both languages and gives the text back to edit.
 *
 * ⛔ THE REFUSED TEXT IS NEVER STORED OR LOGGED. What is kept is ONE anonymous integer per (Vietnam day,
 * edition, surface, category) in kv_store — the signup-prompt-counter precedent: no user id, no text, no
 * term, no IP — so the owner can see whether the filter fires and where, and tune it. kv_store is UNLOGGED
 * (a crash recovery resets the day's totals) — acceptable for a tuning read.
 *   Read them: select key, value from kv_store where key like 'ugc-filter:%' order by key;
 *
 * ⚠️ DELIBERATELY NOT FILTERED: a report's `detail`, a dispute-room statement and an appeal. Those are
 * EVIDENCE — a victim must be able to quote the slur or the threat they received, word for word, to the
 * moderator. Refusing it there would silence exactly the person the filter exists to protect.
 */

export type UgcSurface = 'chat' | 'review' | 'help-comment' | 'help-post'

/** The Vietnam calendar day (UTC+7, no DST) — the same day boundary the signup-prompt counters use. */
const vnDay = (now: number): string => new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)

/** 400 days, like the signup-prompt counters — long enough for any review, then the rl-kv-sweep cron drops them. */
const COUNTER_TTL_SEC = 400 * 24 * 60 * 60
export const UGC_FILTER_COUNTER_PREFIX = 'ugc-filter:'
export const ugcFilterCounterKey = (day: string, edition: string, surface: UgcSurface, category: SevereCategory) =>
  `${UGC_FILTER_COUNTER_PREFIX}${day}:${edition}:${surface}:${category}`

/**
 * Should this post be refused? False — without scanning — while the gate is off. On a hit, counts it
 * (best-effort: a counter never turns a refusal into a 500) and answers true. Every text is checked;
 * empty ones are skipped.
 */
export async function refuseObjectionable(surface: UgcSurface, ...texts: (string | null | undefined)[]): Promise<boolean> {
  if (!appReviewGate('ugc-safety')) return false
  for (const text of texts) {
    const hit = findSevereAbuse(text)
    if (!hit) continue
    try {
      await kv.incrby(ugcFilterCounterKey(vnDay(Date.now()), EDITION, surface, hit.category), 1, COUNTER_TTL_SEC)
    } catch (e) {
      logError(e, { op: 'ugc-filter.count' })
    }
    return true
  }
  return false
}
