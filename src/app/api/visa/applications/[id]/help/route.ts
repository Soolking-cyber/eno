import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaDb } from '@/lib/visa/db'
import { visaDmFailureFor } from '@/lib/visa/dm-flow'
import { getVisaThreadMode, setVisaThreadMode } from '@/lib/visa/dm-thread'

// "THEY CAN REQUEST HUMAN INTERVENTION OR HELP IF NEEDED" — the escape hatch out of the AI
// wizard, without leaving the thread.
//
// Flips the thread's mode to 'human_requested' and puts a message in front of the desk. The
// mode is DERIVED from visa_events (see getVisaThreadMode), so this needs no column and no
// migration; the desk sees the request in the queue and the applicant's unread badge lands
// in the shop's inbox the ordinary way.
//
// ⚠️ 'human_requested' DOES NOT SILENCE THE WIZARD, and that is deliberate (it is the
// documented contract in dm-thread.ts): the applicant is queued for a human and may keep
// filling the form while they wait. Only an ADMIN TAKEOVER stops the cards — that is the
// admin's own route.
//
// ⚠️ ENTITLEMENT LIVES HERE: the case is read scoped by `user_id`, and the thread is
// resolved through Conversation.visaApplicationId with buyerProfileId compared against the
// session. Nobody can flip the mode on a case or a thread that is not theirs.
//
// ⚠️ THE NOTE IS THE APPLICANT'S OWN CHAT MESSAGE, not payload data. It is authored BY THEM,
// in THEIR thread, exactly like anything else they type — the rule this route obeys is that
// no decrypted PAYLOAD field is ever copied into a Message body or into visa_events
// metadata, and nothing here reads the payload at all. The event carries a flag, not text.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// `mode` makes this one endpoint both directions of the toggle (owner, 2026-07-30). Defaults to
// 'human_requested', so every existing caller keeps its exact behaviour.
const bodySchema = z.object({
  note: z.string().trim().max(500).optional(),
  mode: z.enum(['human_requested', 'ai']).default('human_requested'),
}).strict()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Bilingual composite, the price-drop.ts / messages.ts idiom: this string PERSISTS into
// Message.body and Conversation.lastMessageText, where tr() cannot run at render time.
const HELP_REQUEST_LINE = '🙋 Cần nhân viên hỗ trợ · Human help requested'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  // Tight: this pings a human queue. A stuck applicant asks once or twice.
  const limit = await rateLimit('visa-dm-help', userId, 10, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  try {
    // OWNERSHIP, on the cheapest possible read: no decryption (this route never needs the
    // payload, so it works on a host without the crypto env), and `user_id` scoping means a
    // case that is not theirs simply does not exist here.
    const { data: application, error } = await getVisaDb()
      .from('visa_applications').select('id').eq('id', id).eq('user_id', userId).maybeSingle()
    if (error) throw error
    if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    // The thread, via the @unique binding column. Selected in full because insertMessage
    // needs the conversation row (and refuses to author anything without it).
    const convo = await db.conversation.findUnique({
      where: { visaApplicationId: id },
      select: { id: true, buyerProfileId: true, sellerProfileId: true, listingId: true },
    })
    if (!convo) return NextResponse.json({ error: 'thread_not_bound' }, { status: 409 })
    if (convo.buyerProfileId !== userId) return NextResponse.json({ error: 'thread_conflict' }, { status: 409 })

    const wantsHuman = parsed.data.mode === 'human_requested'

    // ⚠️ AN OPERATOR'S TAKEOVER IS NOT THE APPLICANT'S TO TOUCH — IN EITHER DIRECTION.
    //
    // 'admin' means a human is actively on the case. My first cut guarded only the ai direction,
    // which looked like protection while leaving the other door open: mode is the NEWEST event, so
    // an applicant POSTing `human_requested` during a takeover writes a newer event and the derived
    // mode silently stops being 'admin' — ending a takeover nobody ended. codex caught it.
    // Both applicant transitions are refused while an operator holds the case.
    //
    // ⚠️ AND A NO-OP MUST WRITE NOTHING. Without this, tapping the already-selected side again
    // appended another event, another desk message and another notification each time.
    const modeNow = await getVisaThreadMode(id)
    if (modeNow === 'admin') return NextResponse.json({ error: 'admin_takeover' }, { status: 409 })
    const target: 'human_requested' | 'ai' = wantsHuman ? 'human_requested' : 'ai'
    if (modeNow === target) return NextResponse.json({ mode: target, unchanged: true })

    // LOUD ON PURPOSE (dm-thread.ts): the mode read fails soft, but a help request the
    // applicant believes landed and didn't leaves them waiting on nobody. A failed write
    // throws and this route surfaces it.
    await setVisaThreadMode({ applicationId: id, mode: target, actorType: 'applicant', actorRef: userId })

    // Switching the assistant back on is a mode change and nothing else — no message, because
    // there is no one to notify and the thread should not collect chatter on every tap.
    if (!wantsHuman) return NextResponse.json({ mode: 'ai' })

    // Best-effort visibility in the desk's inbox. The mode event above is the load-bearing
    // record (the admin queue reads visa_events); a message that failed to post must not
    // turn a successful request into an error the applicant would retry.
    try {
      const note = parsed.data.note?.trim()
      await insertMessage(convo, userId, note ? `${HELP_REQUEST_LINE} — ${note}` : HELP_REQUEST_LINE)
    } catch (e) {
      console.error('[visa-dm] help message not posted', e)
    }
    return NextResponse.json({ mode: 'human_requested' })
  } catch (error) {
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
