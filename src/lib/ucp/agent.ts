import crypto from 'crypto'
import { kv, rateLimit } from '@/lib/ratelimit'
import { safeFetch } from '@/lib/ssrf'
import { readCapped } from '@/lib/core/read-capped'
import { logError } from '@/lib/log'

/**
 * ── WHO IS CALLING: THE `UCP-Agent` HEADER AND THE PLATFORM'S PROFILE (UCP 2026-08-25, checkout REST binding) ──
 *
 * Every checkout request names its platform: `UCP-Agent: profile="https://…"` (an RFC 8941 dictionary). The business MUST
 * fetch and validate that profile (https, no redirects, no special-use addresses, cached ≥ 60 s) and answer with the
 * capability both sides support, else `capabilities_incompatible` at HTTP 200. eno.vn supports one checkout version.
 *
 * ⛔ AN OUTBOUND FETCH PER UNKNOWN URL IS A LEVER (plan review 2026-11-28): a caller inventing profile URLs could make this
 * server dial out on every request. So the fetch is the repo's SSRF-guarded one (safeFetch: public addresses only, the
 * dialled address pinned against DNS rebinding) with no redirects, 5 s and 64 KB at most; a good answer is cached for an
 * hour and a failure for 60 s; and one address may make this server fetch at most PROFILE_FETCHES_PER_MIN new profiles a minute.
 * ⛔ THE PROFILE IDENTIFIES, IT DOES NOT AUTHENTICATE. Nothing here is privileged (checkout.ts: the session is a quote; the
 * shop pays on eno.vn, signed in), so an unsigned header is accepted as the spec allows.
 */
export const UCP_CHECKOUT = 'dev.ucp.shopping.checkout'
export const CHECKOUT_VERSION = '2026-08-25'

const CACHE_SEC = 3600
const FAIL_CACHE_SEC = 60
const FETCH_TIMEOUT_MS = 5_000
const MAX_PROFILE = 64 * 1024
export const PROFILE_FETCHES_PER_MIN = 10
const PROFILE_FETCHES_ALL_PER_MIN = 120

export type AgentCheck =
  | { ok: true; profile: string }
  | { ok: false; code: 'invalid_request' | 'capabilities_incompatible' | 'rate_limited'; content: string; status: number }

/** The profile URL in a `UCP-Agent` header (`profile="https://…"`), or null when there is none or it is not https. */
export function agentProfileUrl(header: string | null): string | null {
  if (!header) return null
  const m = /(?:^|,)\s*profile\s*=\s*"([^"]{1,2048})"/.exec(header)
  if (!m) return null
  try {
    const u = new URL(m[1])
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

/** Does this platform profile (schemas/ucp.json platform_schema) support eno.vn's checkout version? */
export function supportsCheckout(doc: unknown): boolean {
  const ucp = (doc as { ucp?: { capabilities?: Record<string, unknown> } } | null)?.ucp
  const entries = ucp?.capabilities?.[UCP_CHECKOUT]
  return Array.isArray(entries) && entries.some((e) => (e as { version?: unknown } | null)?.version === CHECKOUT_VERSION)
}

type Cached = { ok: boolean; reason?: string }
const cacheKey = (url: string) => `ucp:agent:${crypto.createHash('sha256').update(url).digest('base64url')}`

async function fetchProfile(url: string): Promise<Cached> {
  try {
    const res = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS, followRedirects: false, headers: { accept: 'application/json' } })
    if (res.status !== 200) { await res.body?.cancel().catch((e) => logError(e, { op: 'ucp.agent.cancel' })); return { ok: false, reason: `the profile answered HTTP ${res.status} (redirects are not followed)` } }
    const buf = await readCapped(res, MAX_PROFILE, 'ucp.agent.read')
    if (!buf) return { ok: false, reason: `the profile is larger than ${MAX_PROFILE} bytes` }
    let doc: unknown
    try { doc = JSON.parse(buf.toString('utf8')) } catch { return { ok: false, reason: 'the profile is not JSON' } }
    return supportsCheckout(doc) ? { ok: true } : { ok: false, reason: `the profile does not list ${UCP_CHECKOUT} at version ${CHECKOUT_VERSION}` }
  } catch (e) {
    // A refused address (private, special-use), a timeout, a TLS failure: the profile cannot be read.
    logError(e, { op: 'ucp.agent.fetch' })
    return { ok: false, reason: 'the profile could not be fetched' }
  }
}

/** Read and check the calling platform. `ip` bounds the new profiles one address can make this server fetch. */
export async function checkAgent(req: Request, ip: string): Promise<AgentCheck> {
  const url = agentProfileUrl(req.headers.get('ucp-agent'))
  if (!url) return { ok: false, code: 'invalid_request', status: 400, content: 'The UCP-Agent header is required: profile="https://…" naming your platform profile.' }
  const key = cacheKey(url)
  let hit = await kv.get<Cached>(key).catch(() => null)
  if (!hit) {
    // Per address AND overall: many addresses minting fresh profile URLs must not turn this server into a fetcher of
    // arbitrary public hosts (commit gate 2026-11-28).
    const [limit, all] = await Promise.all([rateLimit('ucp-agent-fetch', ip, PROFILE_FETCHES_PER_MIN, '1 m'), rateLimit('ucp-agent-fetch-all', 'all', PROFILE_FETCHES_ALL_PER_MIN, '1 m')])
    if (!limit.success || !all.success) return { ok: false, code: 'rate_limited', status: 429, content: 'Too many new platform profiles from this address; retry shortly.' }
    hit = await fetchProfile(url)
    // A good profile is kept an hour (so the shared fetch budget is spent on unknown URLs, not on known platforms); a failure
    // only the spec's minimum of 60 s, so one blip does not lock a platform out.
    await kv.set(key, hit, { ex: hit.ok ? CACHE_SEC : FAIL_CACHE_SEC }).catch((e) => logError(e, { op: 'ucp.agent.cache' }))
  }
  if (!hit.ok) return { ok: false, code: 'capabilities_incompatible', status: 200, content: `Checkout needs ${UCP_CHECKOUT} ${CHECKOUT_VERSION}: ${hit.reason ?? 'not supported'}.` }
  return { ok: true, profile: url }
}
