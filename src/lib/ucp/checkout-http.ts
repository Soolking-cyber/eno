import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'
import { IS_SERVICES } from '@/lib/edition'
import { readCapped } from '@/lib/mcp/read-capped'
import { checkAgent, CHECKOUT_VERSION } from './agent'
import { idempotent, type Outcome } from './idempotency'
import { CheckoutError } from './checkout'

/**
 * The UCP checkout routes' shared door (the protocol: checkout.ts). In order: eno.vn's edition only; per-address and global
 * limits; the calling platform (agent.ts: `UCP-Agent`, its profile fetched and checked — else capabilities_incompatible at
 * HTTP 200); a 64 KB JSON body; on every state change `Idempotency-Key` (idempotency.ts: required, body-hashed, fail
 * closed). A business outcome (an item that cannot be sold, a checkout that cannot change) is HTTP 200 with UCP messages;
 * a session another platform made, or none, is 404.
 */
export const UCP_CHECKOUT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, UCP-Agent, Request-Id, Idempotency-Key, Authorization, Signature, Signature-Input, Content-Digest',
  'Access-Control-Max-Age': '86400',
}
const PER_IP_PER_MIN = 120
const GLOBAL_PER_MIN = 6000
const MAX_BODY = 64 * 1024

/** A UCP error body for checkout (error_response.json). */
export const checkoutError = (code: string, content: string, severity = 'unrecoverable', path?: string) => ({
  ucp: { version: CHECKOUT_VERSION, status: 'error' },
  messages: [{ type: 'error', code, content, severity, ...(path ? { path } : {}) }],
})

/** `mutates`: reads a body. `replay` (default: as `mutates`): needs `Idempotency-Key` and replays a repeat — off for
 *  complete, which takes nothing here and must answer the session's state as it is now, never a stored one (commit gate). */
type Op = { mutates: boolean; replay?: boolean; creates?: boolean; run: (body: unknown, profile: string) => Promise<object | null> }
/** A new session is a kv write that lives a day: bounded per address and per platform (commit gate 2026-11-28). */
const CREATES_PER_IP_PER_MIN = 30
const CREATES_PER_PROFILE_PER_MIN = 120

export async function ucpCheckout(req: Request, op: Op): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store', ...UCP_CHECKOUT_CORS }
  const rid = (req.headers.get('request-id') || '').slice(0, 200)
  if (rid) headers['Request-Id'] = rid
  const json = (body: object, status = 200) => Response.json(body, { status, headers })
  if (IS_SERVICES) return json(checkoutError('not_found', 'No checkout here.'), 404)

  const ip = clientIp(req)
  const [one, all] = await Promise.all([rateLimit('ucp-chk-ip', ip, PER_IP_PER_MIN, '1 m'), rateLimit('ucp-chk-global', 'all', GLOBAL_PER_MIN, '1 m')])
  if (!one.success || !all.success) return Response.json(checkoutError('rate_limited', 'Too many requests; retry shortly.', 'recoverable'), { status: 429, headers: { ...headers, 'Retry-After': String((one.success ? all : one).resetSec) } })

  const agent = await checkAgent(req, ip)
  if (!agent.ok) return json(checkoutError(agent.code, agent.content), agent.status)
  if (op.creates) {
    const [byIp, byProfile] = await Promise.all([
      rateLimit('ucp-chk-create-ip', ip, CREATES_PER_IP_PER_MIN, '1 m'),
      rateLimit('ucp-chk-create-profile', agent.profile, CREATES_PER_PROFILE_PER_MIN, '1 m'),
    ])
    if (!byIp.success || !byProfile.success) return Response.json(checkoutError('rate_limited', 'Too many new checkouts; retry shortly.', 'recoverable'), { status: 429, headers: { ...headers, 'Retry-After': String((byIp.success ? byProfile : byIp).resetSec) } })
  }

  let raw = ''
  let body: unknown = {}
  if (op.mutates) {
    const text = await readCapped(req, MAX_BODY, 'ucp.checkout.readBody')
    if (text === null) return json(checkoutError('invalid_request', `Request too large: at most ${MAX_BODY} bytes.`), 413)
    raw = text
    if (text.trim()) {
      try { body = JSON.parse(text) } catch { return json(checkoutError('invalid_request', 'The body is not valid JSON.'), 400) }
    }
  }

  const exec = async (): Promise<Outcome> => {
    try {
      const out = await op.run(body, agent.profile)
      if (!out) return { status: 404, body: checkoutError('not_found', 'No checkout session with this id.') }
      // A reply carrying a recoverable message ("retry shortly", a fixable line) is never replayed: the retry runs again.
      const retry = ((out as { messages?: { severity?: string }[] }).messages ?? []).some((m) => m.severity === 'recoverable')
      return { status: 200, body: out, ...(retry ? { store: false as const } : {}) }
    } catch (e) {
      if (e instanceof CheckoutError) return { status: 200, body: checkoutError(e.code, e.message, 'recoverable', e.path), store: false }
      logError(e, { op: 'ucp.checkout' })
      return { status: 500, body: checkoutError('internal_error', 'Something went wrong on our side; retry.', 'recoverable') }
    }
  }
  if (!(op.replay ?? op.mutates)) {
    const out = await exec()
    return json(out.body, out.status)
  }
  const key = (req.headers.get('idempotency-key') || '').trim()
  if (!key || key.length > 255) return json(checkoutError('invalid_request', 'The Idempotency-Key header is required (at most 255 characters).'), 400)
  // ⛔ A KEY IS PER OPERATION: the platform, the method and the path (the session id) — the same key used to cancel two
  // sessions must not replay the first one's answer for the second (commit gate 2026-11-28).
  const scope = `${agent.profile} ${req.method} ${new URL(req.url).pathname}`
  const out = await idempotent(scope, key, raw, exec, (code, content) => checkoutError(code, content, 'recoverable'))
  if (out.replayed) headers['Idempotency-Replayed'] = 'true'
  return json(out.body, out.status)
}

export const checkoutOptions = () => new Response(null, { status: 204, headers: UCP_CHECKOUT_CORS })
