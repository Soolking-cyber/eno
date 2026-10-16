import 'server-only'
import { logWarn } from '@/lib/log'
import { FACEBOOK_PROVIDER } from '@/lib/facebook-signin'

/**
 * Is "Continue with Facebook" switched on in GoTrue (sb.eno.vn)? The ONE source of truth: the owner turns it on by
 * configuring GoTrue (infra/vn-node/apply-facebook-signin.sh), and every button follows without a deploy.
 * ⛔ FAILS CLOSED, BRIEFLY: an answer is kept 10 minutes; a failure (a 401 without the apikey, a timeout, a 5xx) only
 * 60 s, and is logged — "Facebook is off" must never be a quiet stand-in for "the probe is broken". (The shape of the
 * reviewed LinkedIn probe, removed with LinkedIn on 2026-10-16.)
 * ⚠️ PUBLIC ROUTE, ON PURPOSE: GoTrue's /settings is not on src/lib/supabase/server-fetch.ts's internal list, and one
 * request per process per 10 minutes does not need to be.
 */
const OK_TTL_MS = 10 * 60_000
const FAIL_TTL_MS = 60_000
let cached: { on: boolean; until: number } | null = null
let refill: Promise<boolean> | null = null

async function probe(): Promise<boolean> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/^"|"$/g, '').replace(/\/$/, '')
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
  if (!base || !key) { cached = { on: false, until: Date.now() + OK_TTL_MS }; return false }
  try {
    const res = await fetch(`${base}/auth/v1/settings`, { headers: { apikey: key }, cache: 'no-store', signal: AbortSignal.timeout(1_500) })
    if (!res.ok) {
      logWarn('[facebook] settings probe refused', { status: res.status })
      cached = { on: false, until: Date.now() + FAIL_TTL_MS }
      return false
    }
    const body = (await res.json()) as { external?: Record<string, unknown> }
    const on = body.external?.[FACEBOOK_PROVIDER] === true
    cached = { on, until: Date.now() + OK_TTL_MS }
    return on
  } catch (e) {
    logWarn('[facebook] settings probe failed', { name: (e as Error)?.name })
    cached = { on: false, until: Date.now() + FAIL_TTL_MS }
    return false
  }
}

export async function facebookSignInEnabled(): Promise<boolean> {
  if (cached && cached.until > Date.now()) return cached.on
  refill ??= probe().finally(() => { refill = null })
  return refill
}

/** Tests only. */
export function resetFacebookProbeForTests() { cached = null; refill = null }
