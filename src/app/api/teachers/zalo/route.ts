// A SCHOOL'S "urgent cover? Show Zalo" on a teacher's profile (owner, 2026-10-28) — rules: src/lib/teachers/zalo.ts.
//
// GET ?listingId=… → the standing, NEVER the number: { available, revealed, tier, limit, used, remaining, resetAt, reason,
//   next } — whether to draw the button and what a tap would do.
// POST { listingId } → the reveal: 200 { zalo, href, standing } · 403 { error: limit | pool | teacher_cap, standing } ·
//   503 busy (try again, nothing counted) · 404 not_available — one answer for every "no" about the teacher (not live,
//   cover or Zalo off, blocked, the teacher themself) AND for an account that may not reveal at all (personal,
//   suspended, revoked), so it is no oracle.
// Keyed by the LISTING (dm-quota's idiom), never an account or profile id on the wire. ⛔ private, no-store on every
// answer. Rate-limited on top of the daily caps against scraping (the listing contact reveal's numbers, strict).
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route, ApiError } from '@/lib/api/handler'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'
import { revealZalo, zaloStanding } from '@/lib/teachers/zalo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const listingIdOf = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 64) : '')

export const GET = route(
  // 600 an hour: one ask per cover profile a school opens (review round 3 — 120 hid the button from a school browsing fast).
  { auth: 'userId', rateLimit: { bucket: 'teacher-zalo-standing', limit: 600, window: '1 h' } },
  async ({ req, userId }) => {
    const listingId = listingIdOf(new URL(req.url).searchParams.get('listingId'))
    if (!listingId) throw new ApiError('bad_request', 400)
    return NextResponse.json(await zaloStanding(userId, listingId, clientIp(req)), { headers: NO_STORE })
  },
)

const Body = z.object({ listingId: z.string().min(1).max(64) })

export const POST = route(
  { auth: 'userId', body: Body, rateLimit: { bucket: 'teacher-zalo-reveal', limit: 30, window: '1 h', strict: true } },
  async ({ req, userId, body }) => {
    const ip = clientIp(req)
    const perIp = await rateLimit('teacher-zalo-reveal-ip', ip, 60, '1 h', { strict: true })
    if (!perIp.success) throw new ApiError('rate_limited', 429)
    const r = await revealZalo(userId, listingIdOf(body.listingId), ip)
    if (!r) return NextResponse.json({ error: 'not_available' }, { status: 404, headers: NO_STORE })
    // Too many reveals in flight on this server (zalo.ts REVEAL_SLOTS): try again — nothing was counted.
    if (!r.ok && r.reason === 'busy') return NextResponse.json({ error: 'busy' }, { status: 503, headers: NO_STORE })
    if (!r.ok) return NextResponse.json({ error: r.reason, standing: r.standing }, { status: 403, headers: NO_STORE })
    return NextResponse.json({ zalo: r.zalo, href: r.href, standing: r.standing }, { headers: NO_STORE })
  },
)
