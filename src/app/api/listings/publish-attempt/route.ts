import { NextResponse, type NextRequest } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'
import { recordPublishOutcome } from '@/lib/publish-funnel'
import { isClientPublishOutcome } from '@/lib/publish-funnel-codes'

// A Publish tap that never reached the server.
//
// ⚠️ WHY A ROUTE EXISTS AT ALL. `submit()` in post-wizard.tsx has five early returns before any
// fetch (missing fields, contact info in the name, contact info in the listing text, a banned
// word, and not signed in). Those are the branches where a seller gives up, and by construction
// they send no request — so /api/listings' own counter, which reads the outcome off a response,
// can never see them. Without this endpoint the funnel reports "0 refused" however many people
// tapped Publish and got nothing.
//
// ⚠️ THIS IS A PUBLIC, UNAUTHENTICATED COUNTER-INCREMENT, and that shape deserves suspicion.
// Guests can post listings, so requiring a session would blind the funnel to exactly the
// first-time sellers it exists to measure. The defences are therefore:
//   · a strict ALLOWLIST of five constants — nothing else is written, so the table can never
//     become a sink for attacker-chosen strings (publish_log also clamps to 40 chars);
//   · a per-IP rate limit, so the cost of inflating a number is bounded;
//   · no reflection of input, no PII, no id of any kind — the body is one enum value;
//   · 204 on every path, so the STATUS never says whether a limit was hit. ⚠️ A reviewer
//     correctly refuted the stronger claim this used to make: the accepted path does one more
//     round trip than the rejected one, so response TIMING still distinguishes them. Identical
//     statuses are not a timing-safe oracle and this file should not pretend otherwise.
// The worst an abuser achieves is making a counter in an internal admin view too high. That is
// worth saying plainly: these numbers are a SIGNAL, not an audit trail, and should never be used
// where correctness matters.
// The longest legal body is {"outcome":"client_signin_required"} — 40 bytes. 200 leaves room for
// whitespace and a stray field without ever being a meaningful buffer.
const MAX_BODY_BYTES = 200

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⚠️ WS6 — NOT MIGRATED, and this route is the clearest non-fit in the whole sweep: it has NO
// error envelope. `done()` answers 204 with an EMPTY BODY on every branch, on purpose (see the
// ⚠️ ALWAYS 204 note below), so route()'s `{"error":"rate_limited"}` 429 would destroy the one
// property the endpoint is built around — that the status never tells a prober where the limit
// sits. The order is wrong too: route() runs auth → rateLimit → body, while BOTH guards that
// matter here must run BEFORE the limiter (the same-origin check, and the content-length +
// delivered-length cap that exists so an unauthenticated caller cannot choose how much parser
// work we do). And the body is read as bounded TEXT and JSON.parse'd afterwards, precisely so it
// is never handed to req.json() unmeasured — which is exactly what `body:` would do.
// Nothing about this shape fits, and forcing it would trade a deliberate design for tidiness.
export async function POST(req: NextRequest) {
  // ⚠️ ALWAYS 204, INCLUDING ON REJECTION. This is fire-and-forget from a form the user is
  // actively using — a 4xx would surface in their console for nothing, and distinguishing
  // "rate limited" from "accepted" would tell a prober exactly where the limit sits. Failing
  // silently is correct for a counter and wrong for almost anything else.
  const done = () => new NextResponse(null, { status: 204 })

  // ⚠️ SAME-ORIGIN ONLY. Without this any third-party page could POST here from a visitor's
  // browser and move these numbers — a cross-origin drive-by write, flagged in review. It is
  // cheap to refuse: our own fetch is same-origin, so `Sec-Fetch-Site: same-origin` holds in
  // every browser that sends the header, and where it is absent we fall back to comparing the
  // Origin host against the request's own. Belt and braces, and it costs one header read.
  //
  // This is NOT a claim that the endpoint is now unforgeable — anything a browser can send, curl
  // can send. It removes the drive-by case (a visitor's browser being used as the weapon) and
  // leaves only deliberate abuse, which the rate limit bounds.
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return done()
  const origin = req.headers.get('origin')
  if (origin) {
    let sameHost = false
    try { sameHost = new URL(origin).host === req.headers.get('host') } catch { sameHost = false }
    if (!sameHost) return done()
  }

  // ⚠️ THE BODY IS AT MOST A 22-CHARACTER ENUM, so refuse anything that cannot be one before
  // handing it to the JSON parser. `req.json()` on an unauthenticated route otherwise buffers and
  // parses whatever arrives, which is parser work an attacker chooses the size of.
  //
  // ⚠️ THE DECLARED LENGTH IS NOT ENOUGH ON ITS OWN — a chunked POST sends no content-length at
  // all, so a header-only check reads 0 and waves the body straight through. That was the residual
  // hole in my first cut, and the repo already had the answer: readBoundedBody in
  // itineraries/generate/route.ts checks the DELIVERED text too. Same shape here.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return done()
  const text = await req.text().catch(() => null)
  if (text === null || text.length > MAX_BODY_BYTES) return done()

  // 30/hour comfortably exceeds honest use: a determined seller might tap Publish a dozen times
  // while fixing fields, and each tap is at most one call. Strict so a Postgres blip cannot
  // uncap it — this is public and unauthenticated, so it fails CLOSED, matching the guest branch
  // of the listing-create limiter.
  //
  // ⚠️ THE KEY IS AN IP, SO THE NUMBER IS PER-CONNECTION, NOT PER-PERSON. Behind CGNAT or a
  // shared office NAT several genuine sellers share one bucket, so this limit can TRUNCATE real
  // refusals; and an attacker with an IPv6 /64 has effectively unlimited keys, since clientIp
  // returns the address verbatim with no prefix truncation. Both were raised in review and both
  // are accepted: the failure mode is a counter that under-reports honest use and over-reports
  // under deliberate attack. That is tolerable for a signal and would NOT be tolerable for
  // anything with an effect, which is why this endpoint only ever increments a number.
  const limit = await rateLimit('publish-attempt', clientIp(req), 30, '1 h', { strict: true })
  if (!limit.success) return done()

  let body: unknown = null
  try { body = JSON.parse(text) } catch { return done() }
  const outcome = (body as { outcome?: unknown } | null)?.outcome
  if (!isClientPublishOutcome(outcome)) return done()

  await recordPublishOutcome(outcome)
  return done()
}
