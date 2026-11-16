import { NextRequest } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'
import { readBytesCapped } from '@/lib/api/body'
import { IDENTITY_RATE_PER_IP, normaliseEmail, registerServiceAuth } from '@/lib/api/agent-auth'
import { agentError, agentJson, agentOptions } from './http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/agent/identity — agent registration (auth.md `identity_endpoint`; src/lib/api/agent-auth.ts says how it works).
 * Only `service_auth` is offered. ⛔ The same 200 for any well-formed email, whether or not it has an account: whether it
 * can connect is decided on /oauth/agent by the signed-in person, so this endpoint tells nobody who has an account.
 * Limits before any write: per caller IP (sized for hosted agents' shared IPs) — never per email, which would let anyone
 * block a real person's agent (plan review), and no site-wide ceiling, which strangers with enough IPs could drain to
 * block everyone's (commit gate, opus). A registration is three small kv rows that expire in 30 minutes.
 */
const BODY_CAP = 4 * 1024

export async function POST(req: NextRequest) {
  const byIp = await rateLimit('agent-identity-ip', clientIp(req), IDENTITY_RATE_PER_IP, '1 h')
  if (!byIp.success) return agentError(429, 'rate_limited', 'Too many registrations. Try again later.', { 'Retry-After': String(byIp.resetSec) })
  let body: Record<string, unknown>
  try {
    const raw = await readBytesCapped(req, BODY_CAP)
    body = JSON.parse(new TextDecoder().decode(raw ?? new Uint8Array())) as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
  } catch {
    return agentError(400, 'invalid_request', 'Send a JSON object, at most 4 KB.')
  }
  if (body.type !== 'service_auth') {
    return agentError(400, 'unsupported_identity_type', 'Only "service_auth" is supported here (identity_types_supported in /.well-known/oauth-authorization-server).')
  }
  const email = normaliseEmail(body.login_hint)
  if (!email) return agentError(400, 'invalid_request', 'login_hint must be the email address of the eno account to connect.')
  try {
    const reg = await registerServiceAuth(email, Math.floor(Date.now() / 1000))
    if (!reg) return agentError(503, 'temporarily_unavailable', 'Registration is temporarily unavailable. Try again in a moment.')
    return agentJson(200, reg)
  } catch (e) {
    logError(e, { op: 'agent.identity' })
    return agentError(503, 'temporarily_unavailable', 'Registration is temporarily unavailable. Try again in a moment.')
  }
}

export const OPTIONS = agentOptions
