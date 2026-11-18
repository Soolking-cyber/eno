import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { SITE_NAME } from '@/lib/edition'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { apiOk } from '@/lib/api/respond'
import { readJsonCapped } from '@/lib/api/body'
import { ApiError } from '@/lib/api/api-error'
import { rateLimit, type RateLimitSnapshot } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import {
  SANDBOX_CATEGORIES, SANDBOX_KEYS_PER_IP_PER_HOUR, SANDBOX_KEY_TTL_SEC, SANDBOX_LISTINGS, SANDBOX_RATE_PER_MIN,
  checkSandboxListing, mintSandboxKey, readSandboxJob, startSandboxJob, verifySandboxKey,
} from '@/lib/api/sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/v1/sandbox/* — the Partner API's sandbox (owner 2026-11-18). One dispatcher, because every route here shares the
 * same test-key guard, the same sandbox marking and the same refusals; the mechanism (keys, jobs, fixtures, input checks)
 * and why it stores nothing is in src/lib/api/sandbox.ts. Documented in the OpenAPI document under `/sandbox/*`.
 * ⛔ EVERY RESPONSE, A REFUSAL INCLUDED, CARRIES `X-Sandbox: true` AND `"sandbox": true`, and `no-store`: an agent must
 * never mistake fixture data for the live catalogue, and a minted key must never sit in a shared cache.
 * Read with `new URL(req.url)`, not `req.nextUrl`: the tests (and any plain Request) carry no nextUrl.
 */
const BASE = '/api/v1/sandbox'
const ORIGIN_BASE = `${OAUTH_ISSUER}${BASE}`
const MAX_BODY = 16 * 1024

function out(body: object, status = 200, rate?: RateLimitSnapshot, headers: Record<string, string> = {}): NextResponse {
  const res = apiOk({ ...body, sandbox: true }, rate, status)
  res.headers.set('X-Sandbox', 'true')
  res.headers.set('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
  return res
}
function fail(status: number, code: string, message: string, rate?: RateLimitSnapshot, headers: Record<string, string> = {}): NextResponse {
  return out({ error: { code, message } }, status, rate, status === 429 && rate ? { 'Retry-After': String(rate.resetSec), ...headers } : headers)
}

/** Which methods each path shape answers; anything else under /sandbox is a JSON 404 or 405. */
function allowed(seg: string[]): string[] | null {
  const [a, id] = seg
  if (seg.length === 0) return ['GET']
  if (seg.length === 1 && a === 'keys') return ['POST']
  if (seg.length === 1 && a === 'categories') return ['GET']
  if (a === 'listings') return seg.length === 1 ? ['GET', 'POST'] : seg.length === 2 ? ['GET', 'PATCH'] : null
  if (a === 'exports') return seg.length === 1 ? ['POST'] : seg.length === 2 && id.length <= 100 ? ['GET'] : null
  return null
}

function index(): NextResponse {
  return out({
    service: `${SITE_NAME} Partner API sandbox`,
    description: 'Try the Partner API without an account or real data: the live response shapes over sample listings, create and update calls that check input and store nothing, and an export that runs as an async job (202 Accepted, then poll). Nothing here reads or changes a real shop.',
    get_a_key: `POST ${ORIGIN_BASE}/keys`,
    key: { prefix: 'eno_test_', lifetime_seconds: SANDBOX_KEY_TTL_SEC, per_ip_per_hour: SANDBOX_KEYS_PER_IP_PER_HOUR, works_on: `${ORIGIN_BASE}/* only` },
    rate_limit: { limit: SANDBOX_RATE_PER_MIN, window_seconds: 60, keyed_by: 'ip' },
    endpoints: ['GET /listings', 'POST /listings', 'GET /listings/{id}', 'PATCH /listings/{id}', 'GET /categories', 'POST /exports', 'GET /exports/{jobId}'],
    base_url: ORIGIN_BASE,
    openapi: `${OAUTH_ISSUER}/openapi.json`,
    docs: `${OAUTH_ISSUER}/developers#sandbox`,
  })
}

async function mintKey(req: Request): Promise<NextResponse> {
  const rate = await rateLimit('apiv1-sandbox-key', clientIp(req), SANDBOX_KEYS_PER_IP_PER_HOUR, '1 h')
  if (!rate.success) return fail(429, 'rate_limited', 'Too many test keys from this address. `Retry-After` says when to try again.', rate)
  const minted = mintSandboxKey(Date.now())
  if (!minted) return fail(503, 'unavailable', 'The sandbox is temporarily unavailable.')
  return out({
    key: minted.key,
    type: 'test',
    expires_at: minted.expiresAt.toISOString(),
    base_url: ORIGIN_BASE,
    note: 'Send it as `Authorization: Bearer <key>`. It works only under the sandbox base URL, on sample data; nothing you send is stored, and every live endpoint refuses it.',
  }, 201, rate)
}

async function handle(req: Request): Promise<NextResponse> {
  const url = new URL(req.url)
  const seg = url.pathname.slice(BASE.length).split('/').filter(Boolean)
  const method = req.method === 'HEAD' ? 'GET' : req.method
  const methods = allowed(seg)
  if (!methods) return fail(404, 'not_found', `No sandbox route matches ${method} ${url.pathname}. See ${ORIGIN_BASE}.`)
  if (!methods.includes(method)) return fail(405, 'method_not_allowed', `Use ${methods.join(' or ')} here.`, undefined, { Allow: methods.join(', ') })
  if (seg.length === 0) return index()
  if (seg[0] === 'keys') return mintKey(req)

  // ⛔ ONLY A SANDBOX KEY IS EVER READ HERE: a live key or access token fails its shape and is refused unlooked-up.
  const raw = /^Bearer\s+(\S+)$/i.exec((req.headers.get('authorization') || '').trim())?.[1] ?? ''
  const key = verifySandboxKey(raw, Date.now())
  if (!key.ok) {
    if (key.reason === 'unavailable') return fail(503, 'unavailable', 'The sandbox is temporarily unavailable.')
    const message = key.reason === 'expired'
      ? `This test key has expired. Mint a new one: POST ${ORIGIN_BASE}/keys.`
      : `Send \`Authorization: Bearer eno_test_…\`, a test key from POST ${ORIGIN_BASE}/keys. Live keys and tokens are never accepted here.`
    return fail(401, 'unauthorized', message, undefined, { 'WWW-Authenticate': raw ? 'Bearer realm="sandbox", error="invalid_token"' : 'Bearer realm="sandbox"' })
  }
  const rate = await rateLimit('apiv1-sandbox', clientIp(req), SANDBOX_RATE_PER_MIN, '1 m')
  if (!rate.success) return fail(429, 'rate_limited', 'Sandbox rate limit exceeded. `Retry-After` says when to try again.', rate)

  const [area, id] = seg
  if (area === 'categories') return out({ categories: SANDBOX_CATEGORIES }, 200, rate)

  if (area === 'exports') {
    const now = Date.now()
    if (!id) {
      const jobId = startSandboxJob(key.keyId, now)
      if (!jobId) return fail(503, 'unavailable', 'The sandbox is temporarily unavailable.')
      const statusUrl = `${ORIGIN_BASE}/exports/${jobId}`
      return out({ jobId, status: 'pending', statusUrl, createdAt: new Date(now).toISOString() }, 202, rate, { Location: statusUrl, 'Retry-After': '2' })
    }
    const job = readSandboxJob(id, key.keyId, now)
    if (!job) return fail(404, 'not_found', 'Unknown or expired job. A job lasts an hour, and only the key that started it can read it.', rate)
    const done = job.status === 'done'
    return out({
      jobId: id,
      status: job.status,
      statusUrl: `${ORIGIN_BASE}/exports/${id}`,
      createdAt: job.createdAt.toISOString(),
      completedAt: done ? job.doneAt.toISOString() : null,
      result: done ? { format: 'json', count: SANDBOX_LISTINGS.length, listings: SANDBOX_LISTINGS } : null,
    }, 200, rate, done ? {} : { 'Retry-After': String(Math.max(1, Math.ceil((job.doneAt.getTime() - now) / 1000))) })
  }

  // listings
  const listing = id ? SANDBOX_LISTINGS.find((l) => l.id === id) : undefined
  if (id && !listing) return fail(404, 'not_found', 'No sandbox listing with that id. GET /listings lists them.', rate)
  if (method === 'GET' && listing) return out({ listing }, 200, rate)
  if (method === 'GET') {
    const p = url.searchParams
    const limit = Math.min(100, Math.max(1, Number.parseInt(p.get('limit') || '50', 10) || 50))
    const q = (p.get('q') || '').trim().toLowerCase().slice(0, 100)
    const cat = (p.get('categorySlug') || '').trim()
    const hits = SANDBOX_LISTINGS.filter((l) => (!cat || l.category.slug === cat) && (!q || `${l.title} ${l.description}`.toLowerCase().includes(q)))
    // The cursor is the last id of the previous page (opaque to clients, as on the live list); an unknown one ends the list.
    const cursor = p.get('cursor')
    const start = cursor ? hits.findIndex((l) => l.id === cursor) + 1 : 0
    const page = cursor && start === 0 ? [] : hits.slice(start, start + limit)
    const next = page.length && start + limit < hits.length ? page[page.length - 1].id : null
    return out({ listings: page, next_cursor: next }, 200, rate)
  }

  let body: unknown
  try {
    body = await readJsonCapped(req, MAX_BODY)
  } catch (e) {
    return e instanceof ApiError && e.status === 413
      ? fail(413, 'payload_too_large', `The body is over ${MAX_BODY} bytes.`, rate)
      : fail(400, 'bad_request', 'Invalid JSON body.', rate)
  }
  const checked = checkSandboxListing(body, method === 'PATCH')
  if (!checked.ok) return fail(checked.status, checked.code, checked.message, rate)
  // The live answers: update `{ ok: true }`, create 201 `{ listing: { id, verified } }`. Here `received` echoes what passed.
  if (listing) return out({ ok: true, stored: false, received: checked.value }, 200, rate)
  return out({ listing: { id: `sbx_new_${crypto.randomBytes(6).toString('hex')}`, verified: true }, stored: false, received: checked.value }, 201, rate)
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE }
