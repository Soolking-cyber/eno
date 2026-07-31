import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { selectVisaDmProduct, visaDmFailureFor } from '@/lib/visa/dm-flow'

// STEP 0: the picker card's POST. Writes the case's CANONICAL product choice — the
// selected_* columns on visa_applications — in one CAS-guarded update that also prefills
// the payload's entryType, then records the audit event, retargets the thread's listing
// (fail-soft), closes the picker card and posts the next card, all server-side.
//
// ⚠️ ENTITLEMENT LIVES HERE (the /advance discipline): the session's profile id is carried
// into selectVisaDmProduct, which scopes the case read by `user_id` AND checks
// Conversation.buyerProfileId. The desk cannot select for an applicant (same reason the
// card-act route excludes admins: a choice made "as" the applicant would forge a consent),
// and a caller can never name a case that is not their own.
//
// ⚠️ THE CLIENT NAMES A PRODUCT, NEVER A PRICE. `{ listingId }`, .strict(). The listing
// must resolve as a CHARGEABLE product server-side — the hidden $0 generic anchor, a
// half-built row, or a foreign listing all refuse — and every price the applicant will
// ever see or pay is re-derived from the listing + a server-issued quote downstream.
//
// ⚠️ IDEMPOTENT: re-POSTing the current selection is a no-op write (no consent-stamp
// reset, no duplicate audit event) while the follow-ups re-run, so a client retry after a
// partial failure converges. See selectVisaDmProduct.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const bodySchema = z.object({
  listingId: z.string().trim().min(1).max(64),
}).strict()

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Per (actor, application) like resend — selection is a deliberate act, not a loop; and
  // the store counts DENIED attempts, so a retry storm extends its own throttle.
  const limit = await rateLimit('visa-select-product', `${userId}:${id}`, 30, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  try {
    const selected = await selectVisaDmProduct({ applicationId: id, userId, listingId: parsed.data.listingId })
    if (!selected.ok) {
      return NextResponse.json(
        { error: selected.error, ...(selected.step ? { step: selected.step } : {}) },
        { status: selected.status },
      )
    }
    // The selection LANDED even when the chained advance could not post a card (it returns
    // null / a failure here) — the next thread-open advance re-ensures the card, so this is
    // still a 200: reporting it as an error would push the client into a retry that
    // re-runs an already-converged operation.
    const advance = selected.advance && selected.advance.ok ? selected.advance : null
    return NextResponse.json({
      changed: selected.changed,
      step: advance?.step ?? null,
      nextMessageId: advance?.messageId ?? null,
      complete: advance?.complete ?? false,
    })
  } catch (error) {
    // Passport-data route: the class of failure, never the driver's message.
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
