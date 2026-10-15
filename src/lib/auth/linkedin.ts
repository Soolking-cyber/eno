import 'server-only'
import { logWarn } from '@/lib/log'
import { LINKEDIN_PROVIDER } from '@/lib/linkedin-signin'

/**
 * Is Sign in with LinkedIn switched on in GoTrue (sb.eno.vn)? The ONE source of truth: the owner turns it on by
 * configuring GoTrue (infra/vn-node/apply-linkedin-signin.sh), and every button follows without a deploy.
 * ⛔ FAILS CLOSED, BRIEFLY: an answer is kept 10 minutes; a failure (a 401 without the apikey, a timeout, a 5xx) only
 * 60 s, and is logged — "LinkedIn is off" must never be a quiet stand-in for "the probe is broken" (plan review).
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
      logWarn('[linkedin] settings probe refused', { status: res.status })
      cached = { on: false, until: Date.now() + FAIL_TTL_MS }
      return false
    }
    const body = (await res.json()) as { external?: Record<string, unknown> }
    const on = body.external?.[LINKEDIN_PROVIDER] === true
    cached = { on, until: Date.now() + OK_TTL_MS }
    return on
  } catch (e) {
    logWarn('[linkedin] settings probe failed', { name: (e as Error)?.name })
    cached = { on: false, until: Date.now() + FAIL_TTL_MS }
    return false
  }
}

export async function linkedinSignInEnabled(): Promise<boolean> {
  if (cached && cached.until > Date.now()) return cached.on
  refill ??= probe().finally(() => { refill = null })
  return refill
}

/** Tests only. */
export function resetLinkedinProbeForTests() { cached = null; refill = null }
