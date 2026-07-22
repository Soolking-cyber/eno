import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { resendVisaDmCard, visaDmFailureFor } from '@/lib/visa/dm-flow'

// RE-SEND THE CURRENT CARD — "also admin can send visa application form from chip if the
// original one is way up in conversation" (owner).
//
// ⚠️ THE OPPOSITE OF /advance, AND THAT IS THE WHOLE POINT. /advance is idempotent by
// contract ("make sure the card for the current step exists") and is called on every upload,
// every tap and every reconnect — which is exactly why it CANNOT serve as a re-send: a card
// that is already live is precisely the card it refuses to post again. This route posts one,
// every time it succeeds. Nothing about /advance was loosened to make that work; the two
// paths sit side by side in dm-flow.ts and neither can be reached through the other.
//
// ⚠️ IT CHANGES NOTHING. No payload write, no status write, no step transition, no card-state
// transition, and no re-quote: a completed case's pay card is re-posted at the amount the live
// card already carries. The only rows this route can create are one Message and one
// visa_events audit line. The re-sent card becomes the live one purely by ORDER — every
// renderer treats the newest visa_step card for the bound case as live and everything above
// it as history.
//
// ⚠️ ENTITLEMENT LIVES HERE, and it is THREAD membership rather than case ownership: the desk
// does not appear in visa_applications.user_id, so the sibling routes' `.eq('user_id', …)`
// test would lock out the very actor the owner asked for. resendVisaDmCard therefore proves
// the caller is the bound conversation's buyer OR its seller, and that the seller seat really
// is the visa desk's own account. BOTH SEATS ARE ALLOWED (the applicant scrolls past the same
// card the desk does); narrowing this to the desk alone is a one-line change in dm-flow.ts.
// The card is authored as the visa shop either way — sendVisaStepCard has no sender argument.
//
// The body is ignored on purpose: there is nothing a client could usefully say. Which card is
// current is a function of the encrypted payload and the uploaded documents, both server-side.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params
  // A non-uuid segment would 400 at the uuid column rather than 404 (the visa-admin idiom).
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // ⚠️ TIGHT, AND STRICT. Unlike /advance this route WRITES A MESSAGE on every success, in a
  // two-party thread the other side cannot mute — an unbounded chip is a spam vector pointed
  // at one person. Keyed per (actor, application) so the desk handling twenty applicants is
  // never throttled by another applicant's thread, while hammering ONE thread is capped.
  // strict:true fails CLOSED: if the limiter is down, no card is posted.
  const limit = await rateLimit('visa-dm-resend', `${userId}:${id}`, 5, '10 m', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'too_many' }, { status: 429 })

  try {
    const resent = await resendVisaDmCard({ applicationId: id, actorId: userId })
    // FAIL CLOSED, LOUDLY — every refusal is a named code the chip renders as a sentence
    // (visaErrorCopy), never a 200 that looks like a card was posted when none was.
    if (!resent.ok) {
      return NextResponse.json(
        { error: resent.error, ...(resent.step ? { step: resent.step } : {}) },
        { status: resent.status },
      )
    }
    return NextResponse.json({ messageId: resent.messageId, step: resent.step, kind: resent.kind })
  } catch (error) {
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
