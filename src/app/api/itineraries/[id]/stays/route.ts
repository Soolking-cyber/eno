import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { stripToPlainText } from '../stops/reorder'
import { replaceStay, type StayEditError } from './replace'

/**
 * Deterministic edits to a saved itinerary's accommodation shortlist.
 *
 * ⚠️ NO AI HERE, matching the sibling stops route: suggesting alternatives is `stays/suggest`, and
 * this endpoint is a pure structural write. Mixing them would put a model call behind a button that
 * is otherwise free, with different costs and different failure modes.
 *
 * ⚠️ ONE ACTION. See `replace.ts` for why deletion is absent rather than pending.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A bounded, flattened, still-non-empty string — the same shape (and the same ordering trap) as the
 * stops route: `.max(n).transform(strip)` would check the RAW length and then strip, so `"**"` passes
 * `.min(1)` and is stored as a blank row. The non-empty check has to run on what will be stored,
 * which is what the trailing `.refine` does.
 */
const flat = (max: number) =>
  z.string().trim().max(max).transform(stripToPlainText).refine((v) => v.length > 0)

/** The same, but allowed to be absent — empty after stripping means "not set", not "empty string". */
const flatOptional = (max: number) =>
  z.string().trim().max(max).transform((v) => stripToPlainText(v) || null).nullable().default(null)

/**
 * ⚠️ THE WRITE BOUNDARY FOR MODEL OUTPUT, AND IT IS THE AUTHORITATIVE ONE. A replacement's fields
 * originate from a suggestion the AI route produced, which the client hands back here — so by the
 * time it arrives it is ordinary untrusted request input, exactly like any other body, and a caller
 * can post one without ever having asked for a suggestion. `replaceStay` writes what it is given.
 *
 * ⚠️ Bounding the LENGTH is not what makes this safe. What does: these are DATA fields rendered as
 * text, never instructions; stripping removes the markup and URLs a suggestion could otherwise
 * smuggle into a traveller's own trip; and the blast radius is that traveller's own trip either way.
 * The name and area must survive stripping non-empty because they are the only two things the list
 * renders unconditionally — a blank one would be an unreadable row with a price attached.
 */
const bodySchema = z.object({
  action: z.literal('replace'),
  stayId: z.string().min(1).max(64),
  replacement: z.object({
    name: flat(180),
    area: flat(180),
    note: flatOptional(600),
    /**
     * VND per night. Bounded like every other money field the AI touches, and named `…Vnd` on the
     * wire so nobody wires a dollar figure into it: the currency column is FORCED to VND by the
     * write, so a mislabelled amount here would silently relabel itself.
     */
    estimatedNightlyVnd: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  }).strict(),
}).strict()

const STATUS: Record<StayEditError, number> = {
  // Also the answer for a stay that is not the caller's — see the note in replace.ts.
  not_found: 404,
  // 409, not 400: the request was well formed, the ROW moved under it. The client reloads; editing
  // the payload and retrying would just lose the race again.
  stale: 409,
  update_failed: 500,
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: itineraryId } = await params
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })

  // Fails OPEN like the other trip routes: this writes no money and calls no model, so a limiter
  // outage must not stop somebody editing their own trip. Tighter than the stops limiter (240)
  // because there is no drag-and-drop here — a swap is one deliberate tap.
  const limit = await rateLimit('itinerary-stays', profile.id, 60, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const { stayId, replacement } = parsed.data
  const result = await replaceStay({
    itineraryId,
    stayId,
    profileId: profile.id,
    replacement: {
      name: replacement.name,
      area: replacement.area,
      note: replacement.note,
      /**
       * Renamed at the boundary: the column is `estimatedNightly` and its unit lives in `currency`.
       *
       * ⚠️ ZERO BECOMES NULL, AND THE RULE LIVES HERE RATHER THAN IN THE DIALOG. The suggest route
       * uses 0 for "I could not estimate this honestly", the dialog already maps it to null before
       * posting, and a review of the finished diff pointed out that this route would happily store a
       * literal 0 from any other caller — a hotel recorded as costing nothing. The page hides it
       * (`stay.estimatedNightly ? … : ''` treats 0 as absent) so it would never have LOOKED wrong,
       * which is what makes it worth fixing: the wrong value would sit in the database until some
       * later renderer or sum read it as free. Null is what "no estimate" means everywhere else in
       * this model, and a genuinely free room is not a thing this field needs to express.
       */
      estimatedNightly: replacement.estimatedNightlyVnd || null,
    },
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 })
  return NextResponse.json({ ok: true })
}
