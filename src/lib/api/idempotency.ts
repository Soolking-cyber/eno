import 'server-only'
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { kv } from '@/lib/ratelimit'

// Idempotency for /api/v1 mutating endpoints. A client sends `Idempotency-Key: <id>` on a
// POST; we run the handler at most once per (api-key, idempotency-key) and replay the
// stored response on a retry — so a network retry of a create never double-applies. No-op
// (just runs once) when the header is absent. Only 2xx results are cached, so a transient
// error stays retryable. TTL 24h. Backed by the Postgres kv layer (see lib/ratelimit.ts).
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
  if (!idem) {
    const r = await run()
    return NextResponse.json(r.body, { status: r.status, headers: headers(rate) })
  }
  const cacheKey = `idem:${keyId}:${idem}`
  const cached = await kv.get<Outcome>(cacheKey).catch(() => null)
  if (cached) return NextResponse.json(cached.body, { status: cached.status, headers: headers(rate, true) })

  // In-progress claim (audit P2 #15): without it, a client that TIMES OUT and retries
  // while the first run is still executing sees a cache miss and double-executes — the
  // exact scenario idempotency exists for. NX = one runner; the loser replays the
  // finished result if it just landed, else gets an honest 409 to retry shortly.
  // A backend blip on the claim fails OPEN (runs) — availability over strictness here,
  // matching the header-absent path.
  const progressKey = `${cacheKey}:running`
  const claimed = await kv.set(progressKey, '1', { nx: true, ex: 120 }).catch(() => 'OK' as const)
  if (claimed === null) {
    const done = await kv.get<Outcome>(cacheKey).catch(() => null)
    if (done) return NextResponse.json(done.body, { status: done.status, headers: headers(rate, true) })
    return NextResponse.json(
      { error: { code: 'idempotency_in_progress', message: 'A request with this Idempotency-Key is still processing. Retry shortly.' } },
      { status: 409, headers: headers(rate) },
    )
  }

  try {
    const r = await run()
    if (r.status >= 200 && r.status < 300) {
      await kv.set(cacheKey, { status: r.status, body: r.body } satisfies Outcome, { ex: TTL_SECONDS }).catch(() => {})
    }
    return NextResponse.json(r.body, { status: r.status, headers: headers(rate) })
  } finally {
    await kv.del(progressKey).catch(() => {})
  }
}
