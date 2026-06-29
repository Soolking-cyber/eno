import 'server-only'
import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

// Idempotency for /api/v1 mutating endpoints. A client sends `Idempotency-Key: <id>` on a
// POST; we run the handler at most once per (api-key, idempotency-key) and replay the
// stored response on a retry — so a network retry of a create never double-applies. No-op
// (just runs once) when the header is absent or Redis is unconfigured. Only 2xx results
// are cached, so a transient error stays retryable. TTL 24h.
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
const redis = url && token ? new Redis({ url, token }) : null
const TTL_SECONDS = 86_400

type Outcome = { status: number; body: unknown }

function headers(rate: { limit: number; remaining: number }, replayed = false): Record<string, string> {
  const h: Record<string, string> = {
    'X-Request-Id': crypto.randomUUID(),
    'X-RateLimit-Limit': String(rate.limit),
    'X-RateLimit-Remaining': String(rate.remaining),
  }
  if (replayed) h['Idempotency-Replayed'] = 'true'
  return h
}

export async function withIdempotency(
  req: Request,
  keyId: string,
  rate: { limit: number; remaining: number },
  run: () => Promise<Outcome>,
): Promise<NextResponse> {
  const idem = (req.headers.get('idempotency-key') || '').trim().slice(0, 200)
  if (!idem || !redis) {
    const r = await run()
    return NextResponse.json(r.body, { status: r.status, headers: headers(rate) })
  }
  const cacheKey = `idem:${keyId}:${idem}`
  const cached = await redis.get<Outcome>(cacheKey).catch(() => null)
  if (cached) return NextResponse.json(cached.body, { status: cached.status, headers: headers(rate, true) })

  const r = await run()
  if (r.status >= 200 && r.status < 300) {
    await redis.set(cacheKey, { status: r.status, body: r.body } satisfies Outcome, { ex: TTL_SECONDS }).catch(() => {})
  }
  return NextResponse.json(r.body, { status: r.status, headers: headers(rate) })
}
