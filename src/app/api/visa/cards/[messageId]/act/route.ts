import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { db } from '@/lib/db'
import { parseMessageMeta, setVisaStepState } from '@/lib/messages'
import { rateLimit } from '@/lib/ratelimit'
import { visaCryptoReady } from '@/lib/visa/crypto'
import { advanceVisaDmFlow, applyVisaDmFieldEdit, visaDmFailureFor } from '@/lib/visa/dm-flow'

// ACTING ON A CARD — the applicant's half of the in-chat wizard.
//
// Three verbs, and they are the owner's three: "auto filled parts just aknowledgment of
// correctness with skip", plus the correction when the passport was read wrong.
//   acknowledge — "yes, that is what my passport says"
//   skip        — "don't make me confirm this" (the acknowledgement is skippable; a
//                  MISSING required answer is not, and the same card keeps asking)
//   edit        — write corrected/typed values into the case
//
// ⚠️ ENTITLEMENT LIVES HERE — four proofs, in order, before anything is written:
//   1. the session is authenticated (getCurrentProfileId, JWT-verified);
//   2. the message exists and is a visa_step CARD (not a chat bubble, not a pay card);
//   3. the card's conversation is THIS user's — Conversation.buyerProfileId == the session.
//      The visa desk's own account is deliberately excluded: acknowledging a passport is the
//      applicant's act, and an admin acting as them would forge a consent;
//   4. the card speaks for the case the thread is CURRENTLY bound to. A rebound thread (a
//      repeat applicant's second case) leaves the earlier case's cards in the timeline as
//      inert history, and history is never actionable → 409 card_superseded.
// The case's own ownership is re-proved a second time downstream: every dm-flow entry point
// scopes its read by `user_id`, so this route's checks are belt AND braces.
//
// ⚠️ 'edit' NEVER TOUCHES A PLAINTEXT COLUMN. Values go through applyVisaDmFieldEdit →
// encryptVisaPayload → visa_applications.encrypted_payload, the same write PATCH
// /api/visa/applications/[id] performs, with a CAS so a racing save cannot be lost. Nothing
// typed here is logged, echoed in an error, or copied into a Message body: refusals name the
// offending KEY and never its value.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['acknowledge', 'skip', 'edit']),
  // ⚠️ PASSPORT DATA. Bounded (a name, a date, an address — never a document), capped in
  // count, and validated for real by visaPayloadSchema inside applyVisaDmFieldEdit against
  // the CARD'S OWN STEP allowlist. This shape is a size gate, not the authorization.
  fields: z.record(z.string().max(64), z.string().max(1200)).optional(),
  /**
   * WHICH step's answers this edit is for — the "go back and check" rail (owner, 2026-07-27:
   * "make so user can go back and check or edit previously given answers in cards").
   *
   * ⚠️ A CLIENT-SUPPLIED STEP IS A CLAIM, AND IT IS BOUNDED BELOW AGAINST THE CARD, never trusted
   * as given: it must be an integer in 1..meta.step, where meta.step comes from the card's own
   * metaJson. That makes the writable set the union of steps the applicant has ALREADY reached,
   * which is exactly the subset of their own payload they could already write while passing
   * through them — no field becomes reachable that was not.
   *
   * Everything that actually authorises the write is unchanged and still downstream:
   * loadVisaDmCase proves ownership, EDITABLE_STATUSES refuses a paid/submitted/cancelled case,
   * visaPayloadSchema revalidates the WHOLE merged payload, and writeVisaPayload keeps its CAS.
   */
  step: z.number().int().min(1).max(5).optional(),
}).strict()

export async function POST(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-dm-card-act', userId, 180, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  // Generic: a zod issue on `fields` can quote the offending VALUE, which here is passport
  // data. The client knows what it sent.
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { messageId } = await params
  // Message.id is a cuid — a bounded opaque string, checked for shape only so a pathological
  // key never reaches the database.
  if (!messageId || messageId.length > 64) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (parsed.data.action === 'edit' && !Object.keys(parsed.data.fields || {}).length) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (Object.keys(parsed.data.fields || {}).length > 40) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  try {
    const row = await db.message.findUnique({
      where: { id: messageId },
      select: {
        id: true, kind: true, metaJson: true, conversationId: true,
        conversation: { select: { buyerProfileId: true, visaApplicationId: true } },
      },
    })
    if (!row || row.kind !== 'visa_step') return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // (3) the thread is the caller's. 403 rather than 404: the card id came from somewhere,
    // and the client needs to tell "not yours" from "gone".
    if (row.conversation.buyerProfileId !== userId) return NextResponse.json({ error: 'not_your_card' }, { status: 403 })
    // Re-validated on read (strict zod) — a blob written by hand or by a future version is
    // an inert bubble, never a live card.
    const meta = parseMessageMeta('visa_step', row.metaJson)
    if (!meta || !('step' in meta)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // (4) history is not actionable.
    if (!row.conversation.visaApplicationId || row.conversation.visaApplicationId !== meta.applicationId) {
      return NextResponse.json({ error: 'card_superseded' }, { status: 409 })
    }
    const applicationId = meta.applicationId

    if (parsed.data.action === 'edit') {
      // ⚠️ THE CARD IS THE CEILING. A step ahead of this card would let a client write fields for
      // a stage the applicant has not reached; anything at or below it they have already been
      // through. Absent = this card's own step, which is exactly the previous behaviour.
      const requested = parsed.data.step
      if (requested !== undefined && requested > meta.step) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      const edited = await applyVisaDmFieldEdit({
        applicationId, userId, step: (requested ?? meta.step) as typeof meta.step, fields: parsed.data.fields || {},
      })
      // KEYS only — `fields` here is the list of payload field NAMES that were refused.
      if (!edited.ok) {
        return NextResponse.json({ error: edited.error, ...(edited.fields ? { fields: edited.fields } : {}) }, { status: edited.status })
      }
    }

    // Recompute FIRST, transition SECOND. The card is only closed once the flow has
    // provably moved past it: if the step is still incomplete the SAME card stays active and
    // is reused (advance is idempotent), so a skip that cannot actually be skipped does not
    // spray a fresh card into the thread on every tap — it just keeps asking.
    const advanced = await advanceVisaDmFlow({ applicationId, userId })
    if (!advanced.ok) {
      return NextResponse.json(
        { error: advanced.error, ...(advanced.step ? { step: advanced.step } : {}) },
        { status: advanced.status },
      )
    }
    if (advanced.complete || advanced.step !== meta.step) {
      // 'skipped' is the honest record when the applicant declined to confirm, even though
      // the step turned out to be satisfied anyway. (advance may already have closed this
      // card as 'done' when it emitted the next one; this re-states the applicant's verb.)
      await setVisaStepState(row.conversationId, row.id, parsed.data.action === 'skip' ? 'skipped' : 'done')
    }
    return NextResponse.json({ ok: true, step: advanced.step, nextMessageId: advanced.messageId })
  } catch (error) {
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
