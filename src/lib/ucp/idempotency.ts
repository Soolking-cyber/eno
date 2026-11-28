import crypto from 'crypto'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'

/**
 * ── IDEMPOTENCY FOR THE UCP CHECKOUT (2026-08-25: REST binding + signatures page) ──
 *
 * A state-changing call carries `Idempotency-Key`. The business MUST keep the key with the operation's result for at least
 * 24 hours (48 here), answer a repeat with the same body — compared as the SHA-256 of the raw bytes — with the stored
 * result, refuse a repeat with a different body with 409 without running it, and FAIL CLOSED (503) when it cannot store or
 * read keys. Keys are per platform and per operation (profile, method, path), so they never collide across either.
 * Not /api/v1's withIdempotency (src/lib/api/idempotency.ts): that one fails open and does not compare bodies, which the
 * spec forbids here. Results of ours that failed (5xx) are not stored, so a retry runs again.
 */
const TTL_SEC = 48 * 3600
const RUNNING_SEC = 60

/** `store: false`: a reply that says "retry" (a recoverable message) is answered but never kept, so the retry runs. */
export type Outcome = { status: number; body: object; store?: false }
type Stored = Outcome & { h: string }

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('base64url')

export async function idempotent(
  /** Whose and which operation: the platform's profile, the method and the path (checkout-http.ts). */
  profile: string,
  key: string,
  rawBody: string,
  run: () => Promise<Outcome>,
  fail: (code: string, content: string) => object,
): Promise<Outcome & { replayed?: boolean }> {
  const k = `ucp:idem:${sha(profile)}:${sha(key)}`
  const h = sha(rawBody)
  let stored: Stored | null
  try {
    stored = await kv.get<Stored>(k)
  } catch (e) {
    logError(e, { op: 'ucp.idem.get' })
    return { status: 503, body: fail('idempotency_unavailable', 'Idempotency storage is unavailable; retry shortly.') }
  }
  if (stored) {
    if (stored.h !== h) return { status: 409, body: fail('idempotency_key_reused', 'This Idempotency-Key was used with a different request body.') }
    return { status: stored.status, body: stored.body, replayed: true }
  }
  let claimed: 'OK' | null
  try {
    claimed = await kv.set(`${k}:run`, h, { nx: true, ex: RUNNING_SEC })
  } catch (e) {
    logError(e, { op: 'ucp.idem.claim' })
    return { status: 503, body: fail('idempotency_unavailable', 'Idempotency storage is unavailable; retry shortly.') }
  }
  if (claimed === null) return { status: 409, body: fail('idempotency_in_progress', 'A request with this Idempotency-Key is still running; retry shortly.') }
  try {
    const out = await run()
    if (out.status < 500 && out.store !== false) {
      try {
        await kv.set(k, { status: out.status, body: out.body, h } satisfies Stored, { ex: TTL_SEC })
      } catch (e) {
        // The operation ran but its key was not kept: logged; a retry with this key runs it again.
        logError(e, { op: 'ucp.idem.set' })
      }
    }
    return out
  } finally {
    await kv.del(`${k}:run`).catch((e) => logError(e, { op: 'ucp.idem.del' }))
  }
}
