import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { deleteStop, reorderStop, replaceStop, stripToPlainText, swapStops, type StopEditError, type StopEditResult } from './reorder'

/**
 * A bounded, flattened, still-non-empty string.
 *
 * ⚠️ THE ORDER MATTERS AND I GOT IT WRONG THE FIRST TIME. `.min(1).max(180).transform(strip)`
 * checks the length of the RAW value and then strips it, so `"**"` passes `.min(1)` and is written
 * as an empty name — a blank row in the traveller's day. The non-empty check has to run on what
 * will actually be stored, which is what the trailing `.refine` does.
 */
const flat = (max: number) =>
  z.string().trim().max(max).transform(stripToPlainText).refine((v) => v.length > 0)

/** The same, but a field that is allowed to be absent — empty after stripping means "not set". */
const flatOptional = (max: number) =>
  z.string().trim().max(max).transform((v) => stripToPlainText(v) || null).nullable().default(null)

/**
 * Deterministic edits to a saved itinerary's stops.
 *
 * ⚠️ NO AI HERE, deliberately. "Research this place", "find something nearby" is a separate task,
 * and mixing it in would put a model call behind a button that today is a pure structural write —
 * different cost, different failure modes, different rate limit.
 *
 * Ownership is proven inside the edit functions, against the session profile and the itinerary in
 * the PATH, so a guessable dayId is not enough. Missing and not-yours both answer 404, so a
 * signed-in stranger cannot use these routes to discover which days exist.
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('reorder'),
    dayId: z.string().min(1).max(64),
    stopId: z.string().min(1).max(64),
    toIndex: z.number().int().min(0).max(64),
  }).strict(),
  z.object({
    action: z.literal('swap'),
    dayId: z.string().min(1).max(64),
    stopIdA: z.string().min(1).max(64),
    stopIdB: z.string().min(1).max(64),
  }).strict(),
  z.object({
    action: z.literal('delete'),
    dayId: z.string().min(1).max(64),
    stopId: z.string().min(1).max(64),
  }).strict(),
  // ⚠️ THE WRITE BOUNDARY FOR MODEL OUTPUT, AND IT IS THE AUTHORITATIVE ONE. A replacement's fields
  // originate from a suggestion the AI route produced, which the client hands back here — so by the
  // time it arrives it has been through a browser and is ordinary untrusted request input, exactly
  // like any other body. `replaceStop` writes what it is given verbatim, on purpose: bounding it in
  // two places would mean neither place was in charge.
  //
  // The suggest route strips the same way before it DISPLAYS a candidate (shared `stripToPlainText`,
  // one definition), but this route never assumes that happened — a caller can post a `replace`
  // without ever having asked for a suggestion.
  //
  // ⚠️ Bounding the LENGTH is not what makes this safe (agy refuted that framing on the task) — what
  // makes it safe is that these are DATA fields rendered as text, never instructions, and that
  // stripping removes the markup and URLs that would let a suggestion smuggle a link into a
  // traveller's own itinerary. Blast radius is the traveller's own trip either way: this is
  // abuse-of-service, not cross-tenant.
  z.object({
    action: z.literal('replace'),
    dayId: z.string().min(1).max(64),
    stopId: z.string().min(1).max(64),
    replacement: z.object({
      name: flat(180),
      place: flat(180),
      time: flatOptional(40),
      details: flatOptional(900),
      // Vietnam bbox, the same gate every AI coordinate in this app passes. `(0,0)` in production is
      // recorded history — see the itinerary generate route.
      lat: z.number().min(8).max(24).nullable().default(null),
      lng: z.number().min(102).max(110).nullable().default(null),
      travelMinutes: z.number().int().min(0).max(720).nullable().default(null),
      estimatedCostVnd: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
      bookingAdvice: flatOptional(400),
    }).strict(),
  }).strict(),
])

const STATUS: Record<StopEditError, number> = {
  // Also the answer for a day that is not the caller's — see the note above.
  not_found: 404,
  forbidden: 403,
  invalid_order: 400,
  // 409, not 400: the request was well formed, the DAY moved under it. The client reloads; editing
  // the payload and retrying would just lose the race again.
  stale: 409,
  update_failed: 500,
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: itineraryId } = await params
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })

  // Fails OPEN like the other trip routes: a structural edit writes no money and calls no model, so
  // a limiter outage must not stop somebody rearranging their own day. Generous enough for
  // drag-and-drop, which fires one request per drop.
  const limit = await rateLimit('itinerary-stops', profile.id, 240, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  let result: StopEditResult
  switch (parsed.data.action) {
    case 'reorder':
      result = await reorderStop({ ...parsed.data, itineraryId, profileId: profile.id })
      break
    case 'swap':
      result = await swapStops({ ...parsed.data, itineraryId, profileId: profile.id })
      break
    case 'delete':
      result = await deleteStop({ ...parsed.data, itineraryId, profileId: profile.id })
      break
    case 'replace':
      result = await replaceStop({ ...parsed.data, itineraryId, profileId: profile.id })
      break
  }

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 })
  // The new ordering, so a client can reconcile without a refetch — and so an optimistic UI that
  // guessed wrong is corrected by the response rather than left drifted.
  return NextResponse.json({ positions: result.positions })
}
