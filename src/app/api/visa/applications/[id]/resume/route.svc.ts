import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { advanceVisaDmFlow, resendVisaDmCard, visaDmFailureFor } from '@/lib/visa/dm-flow'
import { bindVisaThread, findVisaThread } from '@/lib/visa/dm-thread'

// RESUME A SPECIFIC CASE IN THE CHAT — "when i edit visa in my evisa page it should load the
// relevant draft in chat, and the bring-form chip should have a dropdown to select which one
// they want to bring" (owner, 2026-07-24).
//
// ⚠️ WHY THIS ROUTE HAS TO EXIST NOW. Until today a buyer had exactly one editable draft, so
// "open the chat" and "open THIS case" were the same sentence — the dashboard could link
// straight to the thread and be right by construction. Applying for a different visa type now
// mints its own case, so a buyer holds several drafts against ONE buyer↔desk conversation whose
// `visaApplicationId` names a single ACTIVE case. Without this route the dashboard's per-row
// "Continue in chat" would open the thread showing whichever OTHER case happened to hold the
// pointer — the row would lie about what it opens.
//
// It does exactly two things, in this order:
//   1. bindVisaThread — proves OWNERSHIP (fails closed) and moves the live pointer to this case
//      inside one transaction (unbind-then-claim). The previously-active case is not harmed:
//      its cards stay in the timeline as inert history and its own IMMUTABLE
//      visa_applications.conversation_id still points here, so it can be resumed right back.
//   2. resendVisaDmCard — posts THIS case's current card at the bottom, which is what makes the
//      thread actually usable after the switch rather than leaving the applicant to scroll for
//      a form that may be hundreds of messages up.
//
// ⚠️ NOT FOR NON-EDITABLE CASES, by the caller's choice: a submitted or paid case has no form
// to bring, and moving the live pointer onto it would make a real draft's cards inert for no
// benefit. The dashboard only calls this from a row it labels "Continue in chat".
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** bindVisaThread's refusals, as HTTP. `not_owner` is deliberately 403 and never 404: the
 *  ownership probe already fails closed on a backend error, so a 404 here would tell a
 *  stranger "this id does not exist" on what may be somebody else's real case. */
const BIND_STATUS: Record<string, number> = {
  not_owner: 403,
  thread_conflict: 409,
  shop_unavailable: 503,
  listing_unavailable: 503,
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Writes a Message on every success (the re-posted card) and moves a binding, so it carries
  // the same posture as /resend: keyed per (actor, application) so switching between your own
  // two cases is never throttled by somebody else, and strict so a limiter outage posts nothing.
  const limit = await rateLimit('visa-dm-resume', `${userId}:${id}`, 10, '10 m', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'too_many' }, { status: 429 })

  try {
    const bound = await bindVisaThread({ applicationId: id, buyerProfileId: userId })
    if (!bound.ok) {
      return NextResponse.json({ error: bound.error }, { status: BIND_STATUS[bound.error] ?? 409 })
    }

    // The binding is the part that had to succeed — it is what makes this case the one the
    // thread acts on. The card is a convenience on top, so a refusal here is reported WITHOUT
    // pretending the resume failed: the client still navigates to a correctly-bound thread and
    // the chip can post the form itself. (Its own rate limit is the usual reason.)
    const resent = await resendVisaDmCard({ applicationId: id, actorId: userId })
    let cardPosted = resent.ok
    let cardError = resent.ok ? undefined : resent.error
    if (!resent.ok) {
      // ⚠️ A REBIND WITHOUT A LIVE CARD IS THE WORST STATE THIS ROUTE CAN LEAVE. The pointer
      // has already moved, so the newest card on screen belongs to the case that just lost it
      // — and tapping that card answers "This chat is not linked to an application yet"
      // (advanceVisaDmFlow's thread_not_bound). Telling the applicant to press the chip is not
      // a fix when the chip is what just failed.
      //
      // advance is the idempotent "make sure the card for the current step EXISTS" path, so it
      // recovers exactly this: it cannot double-post (a card already live for the step is
      // precisely what it refuses to re-send), and it needs no re-quote or payload write.
      const advanced = await advanceVisaDmFlow({ applicationId: id, userId })
      if (advanced.ok) { cardPosted = true; cardError = undefined }
    }

    // ⚠️ BIND AND RESEND ARE TWO AWAITS, NOT ONE TRANSACTION (codex, plan review). A second
    // resume — another tab, a double tap — can move the live pointer in between, and the card
    // we just posted would then already be inert history. Last action wins is the right
    // outcome, but claiming success for a card the thread will ignore is not, so re-read the
    // binding and say so. findVisaThread is a findUnique on the @unique pointer column, so a
    // null here means exactly one thing: some other case now holds it.
    const stillLive = await findVisaThread(id)
    return NextResponse.json({
      conversationId: bound.conversationId,
      cardPosted,
      ...(cardError ? { cardError } : {}),
      // The client uses this to say "another tab switched application" rather than dropping
      // the applicant into a thread whose form is silently not the one they asked for.
      ...(stillLive ? {} : { superseded: true }),
    })
  } catch (error) {
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
