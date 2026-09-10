import 'server-only'

/**
 * Client for the self-hosted translation server (infra/vn-node/mt-server, m2m100_418M/MIT).
 *
 * ⛔ WHY A GATE AND NOT JUST A FETCH. Measured on the box against 300 real listing pairs:
 * m2m100_418M keeps 99.6% of model codes on vi→en and 98.5% on en→vi. The remaining fraction
 * matters because the Translation table has NO EXPIRY — a bad row is permanent — and because
 * entity loss is the cheapest available SIGNAL that a whole string went wrong. That link was
 * unmistakable in the model this server was first built on (NLLB-600M, since rejected for its
 * non-commercial licence), where a dropped model code reliably meant invented text:
 *   "Máy lạnh Daikin 1.0HP 2025 (FTKB25ZVMV/RKB25ZVMV)"
 *     → "The cooling system is designed to be used in the manufacture of refrigeration..."
 * m2m100 renders that one correctly, so the gate now fires rarely — which is the point. It
 * costs nothing when the model is right and it stops a permanent bad row when it is not.
 *
 * ⚠️ THE GATE IS DELIBERATELY CONSERVATIVE — it rejects, it never repairs. A "fix" that
 * spliced the missing model code back into the translated string would produce a sentence
 * that reads fluently and still describes the wrong product, which is strictly worse than
 * admitting failure: the caller can pay for a good translation, but it cannot detect a
 * plausible-looking lie.
 */

const MT_URL = process.env.MT_LOCAL_URL

/**
 * How long a BACKGROUND caller waits for the box model.
 *
 * ⚠️ SIZED TO THE REAL WORST CASE, NOT TO A COMFORTABLE NUMBER. A chunk is capped upstream at
 * 100 items / 28,000 characters; at the measured ~250-350 ch/s that is ~112s at idle, and behind
 * a concurrent import batch on the fair lock it goes well past three minutes. A 180s timeout
 * therefore made the LARGEST batches deterministically abort, pay Google for all of them, and
 * leave the box still grinding on work nobody would read. Aborting does not cancel the server,
 * so this must be long enough that reaching it means something is genuinely wrong.
 */
const LONG_TIMEOUT_MS = 600_000

/**
 * How long an INTERACTIVE caller waits before giving up and paying.
 *
 * ⛔ A RENDER CANNOT WAIT TEN MINUTES. Cloudflare cuts a request at ~100s, so a PDP first-view
 * translation queued behind import chunks would be killed at the edge long before the local
 * fetch gave up — the visitor gets a 5xx instead of the paid translation that was one fallback
 * away (opus, reviewing this diff). Interactive callers also ask the paid provider FIRST; this
 * bound is the second line of defence, for when no paid provider answered either.
 */
export const INTERACTIVE_TIMEOUT_MS = 15_000

export function localMtConfigured(): boolean {
  return !!MT_URL
}

/**
 * ⚠️ THE GATE LIVES IN `mt-gate.ts`, NOT HERE, and is re-exported so existing importers and the
 * test file keep working. It moved because `scripts/backfill-bilingual.ts` translates the whole
 * catalogue offline through Node and cannot import a `server-only` module — and a backfill that
 * writes straight into `title`/`description` needs the SAME gate as the request path, not a
 * hand-rolled copy that drifts.
 */
export { gateTranslation, type MtReject } from './mt-gate'
import { gateTranslation, type MtReject } from './mt-gate'

export type LocalMtResult = {
  /** Translated text, or null where the gate refused / the server had no answer. */
  values: (string | null)[]
  rejects: Partial<Record<MtReject, number>>
}

/**
 * Translate a chunk locally. Returns `null` for the WHOLE chunk only when the server itself
 * is unreachable, too slow for this caller, or misbehaving; individual strings come back null when the gate refuses them,
 * so the caller can pay for exactly those and keep the rest free.
 */
export async function localTranslate(
  texts: string[],
  source: string,
  target: string,
  timeoutMs = LONG_TIMEOUT_MS,
): Promise<LocalMtResult | null> {
  if (!MT_URL || texts.length === 0) return null
  try {
    const res = await fetch(`${MT_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, source, target }),
      // ⚠️ SIZED TO THE REAL WORST CASE, NOT TO A COMFORTABLE NUMBER. A chunk is capped upstream
      // at 100 items / 28,000 characters; at the measured ~250 ch/s that is ~112s at idle, and
      // behind a concurrent import batch on the fair lock it exceeds 180s — so a 180s timeout
      // made the LARGEST batches deterministically abort, pay Google for all of them, AND leave
      // the box still grinding on work nobody would read, stalling everything behind it (opus,
      // reviewing this diff). Aborting does not cancel the server, so the timeout must be long
      // enough that reaching it means something is actually wrong. Chat does not wait on this:
      // it asks the paid provider first.
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      console.error('[mt-local] HTTP', res.status)
      return null
    }
    const json = (await res.json()) as { translations?: unknown }
    const out = json?.translations
    // ⛔ A misaligned array must never be paired positionally — that caches wrong translations
    // permanently. The server refuses to send one; this refuses to trust it anyway.
    if (!Array.isArray(out) || out.length !== texts.length) {
      console.error('[mt-local] misaligned response', Array.isArray(out) ? out.length : typeof out, '!=', texts.length)
      return null
    }
    const rejects: Partial<Record<MtReject, number>> = {}
    const values = texts.map((src, i) => {
      const hyp = typeof out[i] === 'string' ? (out[i] as string) : ''
      const reject = gateTranslation(src, hyp, target, source)
      if (reject) {
        rejects[reject] = (rejects[reject] ?? 0) + 1
        return null
      }
      return hyp
    })
    return { values, rejects }
  } catch (err) {
    console.error('[mt-local] request failed', err)
    return null
  }
}
