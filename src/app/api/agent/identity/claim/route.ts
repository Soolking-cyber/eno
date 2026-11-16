import { NextRequest } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'
import { readBytesCapped } from '@/lib/api/body'
import { IDENTITY_RATE_PER_IP, reissueAttempt } from '@/lib/api/agent-auth'
import { agentError, agentJson, agentOptions } from '../http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/agent/identity/claim — a fresh code for an open service_auth registration (auth.md `claim_endpoint`): the
 * agent sends its claim_token and the same email; the previous code stops working. At most MAX_ATTEMPTS per registration.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit('agent-claim-ip', clientIp(req), IDENTITY_RATE_PER_IP * 2, '1 h')
  if (!rl.success) return agentError(429, 'rate_limited', 'Too many requests. Try again later.', { 'Retry-After': String(rl.resetSec) })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(new TextDecoder().decode((await readBytesCapped(req, 4 * 1024)) ?? new Uint8Array())) as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
  } catch {
    return agentError(400, 'invalid_request', 'Send a JSON object, at most 4 KB.')
  }
  try {
    const r = await reissueAttempt(body.claim_token, body.email, Math.floor(Date.now() / 1000))
    return r.ok ? agentJson(200, r.body) : agentError(r.status, r.error, r.message)
  } catch (e) {
    logError(e, { op: 'agent.claim' })
    return agentError(503, 'temporarily_unavailable', 'Try again in a moment.')
  }
}

export const OPTIONS = agentOptions
