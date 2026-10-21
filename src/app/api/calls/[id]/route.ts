import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { maskEmailHandle } from '@/lib/utils'
import { verifiedIdentityFor } from '@/lib/kyc/identity'
import { participantCall } from '@/lib/calls/server/http'
import { RING_TIMEOUT_S, endReasonFor } from '@/lib/calls/server/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── IN-APP CALLS: WHO IS CALLING ABOUT WHAT (DESIGN.md v3 §3.2 step 2, §4 ring screen) ────────────────────────────
//
// The ring broadcast carries ids and audio/video only — names and listing titles never sit in realtime.messages —
// so the ring overlay and the call screen read the rest here, participant-only (404 otherwise).
//   · the other person: display name, avatar, verified identity yes/no, member since, and which side of the listing
//     they are on ("Buyer of <listing>" — §4: role + listing first, so a stranger cannot pose as eno);
//   · the listing: id + title;
//   · for the CALLEE while ringing: the caller's commitment C. ⚠️ The callee must freeze it from THIS response before
//     it sends its own nonce in the accept (sas.ts) — it is deliberately absent from the resync snapshot.
export const GET = route({ auth: 'userId', rateLimit: { bucket: 'calls:details', limit: 120, window: '1 m' } }, async ({ params, userId }) => {
  const { row, role } = await participantCall(params.id, userId)
  const peerId = role === 'caller' ? row.callee_id : row.caller_id
  const convo = await db.conversation.findUnique({
    where: { id: row.conversation_id },
    select: { buyerProfileId: true, listing: { select: { id: true, title: true } } },
  })
  const peer = peerId
    ? await db.profile.findUnique({ where: { id: peerId }, select: { displayName: true, email: true, avatarUrl: true, createdAt: true } })
    : null
  const peerVerified = peerId ? (await verifiedIdentityFor(peerId)) !== null : false
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
    connectedAt: row.connected_at?.toISOString() ?? null,
    commit: role === 'callee' && row.state === 'ringing' ? row.caller_commit : null,
    // The ids the commitment binds — stored at start (session.ts commitTag), so the callee gets exactly what the caller
    // committed with, whichever edition each of them is on.
    commitIds: row.caller_tag && row.callee_tag ? { caller: row.caller_tag, callee: row.callee_tag } : null,
    peer: {
      name: peer?.displayName || maskEmailHandle(peer?.email) || null,
      avatarUrl: peer?.avatarUrl ?? null,
      verified: peerVerified,
      memberSince: peer?.createdAt.toISOString() ?? null,
      side: peerId && convo ? (convo.buyerProfileId === peerId ? 'buyer' : 'seller') : null,
    },
    listing: convo?.listing ? { id: convo.listing.id, title: convo.listing.title } : null,
  }
})
