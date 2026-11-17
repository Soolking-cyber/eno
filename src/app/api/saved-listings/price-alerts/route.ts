// The signed-in account's PRICE-DROP ALERTS switch (owner, 2026-11-17 — Reverb study: "explicit opt-in"), in the /saved
// header (price-alerts-button.tsx). Its own endpoint, like the job-messages switch (api/teachers/me/job-dms): saves on
// toggle, and a withdrawal always goes through. The rules and the evidence: src/lib/price-alerts.ts.
// GET — `{ on }`: the switch counts only when its last ON was given under the notice in force.
// POST — `{ on: false }` switches it OFF: ⛔ never rate-limited, never refused. `{ on: true, notice }` switches it ON: `notice` is
//   the PRICE_ALERT_NOTICE_VERSION the page showed — any other → 409 `notice_changed`, nothing written; 20 an hour, strict → 429.
// No `agent: true`: an AI agent cannot consent for the person.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { actingAccountMismatch } from '@/lib/api/acting-account'
import { rateLimit } from '@/lib/ratelimit'
import { PriceAlertNoticeChangedError, readPriceAlerts, setPriceAlerts } from '@/lib/price-alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export const GET = route({ auth: 'profile' }, async ({ profile }) => NextResponse.json({ on: await readPriceAlerts(profile.id) }, { headers: NO_STORE }))

// z.object strips what it does not name: an OFF's `notice` (or a `profileId`) never reaches the save.
const Body = z.discriminatedUnion('on', [
  z.object({ on: z.literal(false) }),
  z.object({ on: z.literal(true), notice: z.string().max(40) }),
])

export const POST = route({ auth: 'profile', body: Body }, async ({ req, profile, body }) => {
  // ⛔ FIRST: the account whose page made this tap. A tab still showing one account after another tab switched the shared cookie
  // must not record the OTHER account's consent (the notification and push routes' F6 rule; the commit gate, 2026-11-17).
  if (actingAccountMismatch(req, profile.id)) throw new ApiError('account_changed', 409)
  // ⛔ AN OFF NEVER REACHES THE LIMITER: a spent bucket, or a limiter that errors, must never keep alerts coming. 20 ONs an hour —
  // the toggles land in the shared evidence log (one chain lock), not a table of their own.
  if (body.on) {
    const rl = await rateLimit('saved-price-alerts', profile.id, 20, '1 h', { strict: true })
    if (!rl.success) throw new ApiError('rate_limited', 429)
  }
  try {
    return NextResponse.json({ on: await setPriceAlerts(profile.id, body.on, body.on ? body.notice : null) }, { headers: NO_STORE })
  } catch (e) {
    if (e instanceof PriceAlertNoticeChangedError) return NextResponse.json({ error: 'notice_changed' }, { status: 409 })
    throw e
  }
})
