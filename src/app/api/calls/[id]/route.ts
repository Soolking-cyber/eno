import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { participantCall, peerCard } from '@/lib/calls/server/http'
import { RING_TIMEOUT_S, callClock, endReasonFor } from '@/lib/calls/server/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: WHO IS CALLING ABOUT WHAT (DESIGN.md v3 §3.2 step 2, §4 ring screen) ────────────────────────────
//
// The ring broadcast carries ids and audio/video only — names and listing titles never sit in realtime.messages —
// so the ring overlay and the call screen read the rest here, participant-only (404 otherwise).
//   · the other person: display name, avatar, verified identity yes/no, member since, and which side of the listing
//     they are on ("Buyer of <listing>" — §4: role + listing first, so a stranger cannot pose as eno);
//   · the listing: id + title.
export const GET = route({ auth: 'userId', rateLimit: { bucket: 'calls:details', limit: 120, window: '1 m' } }, async ({ params, userId }) => {
  const { row, role } = await participantCall(params.id, userId)
  const peerId = role === 'caller' ? row.callee_id : row.caller_id
  const convo = await db.conversation.findUnique({
    where: { id: row.conversation_id },
    select: { buyerProfileId: true, listing: { select: { id: true, title: true } } },
  })
  const [peer, clock] = await Promise.all([peerCard(peerId, convo?.buyerProfileId ?? null), callClock(row.id)])
  return {
    callId: row.id,
    conversationId: row.conversation_id,
    media: row.media,
    role,
    state: row.state,
    endReason: endReasonFor(row, role),
    protocolVersion: row.protocol_version,
    ringingAt: row.ringing_at.toISOString(),
    ringTimeoutSec: RING_TIMEOUT_S,
    // How long it still rings, by the DATABASE's clock (session.ts callClock): the phone's own clock can be minutes
    // off, and a ring timed from ringingAt on it could last one second (client review).
    ringRemainingMs: clock?.ringRemainingMs ?? 0,
    connectedAt: row.connected_at?.toISOString() ?? null,
    peer,
    listing: convo?.listing ? { id: convo.listing.id, title: convo.listing.title } : null,
  }
})
