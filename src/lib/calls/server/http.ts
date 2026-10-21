import 'server-only'
import { after } from 'next/server'
import { z } from 'zod'
import { ApiError } from '@/lib/api/handler'
import type { CallEndReason, CallRole } from '../types'
import { MAX_OPAQUE_JSON_LENGTH, PEER_END_REASONS, callIdSchema, sasNonceSchema, tabIdSchema } from '../protocol'
import { endCall, loadCall, roleOf, type CallSessionRow, type EndedCallRow } from './session'
import { afterCallEnded } from './finish'
import { logError } from '@/lib/log'
import { db } from '@/lib/db'
import { maskEmailHandle } from '@/lib/utils'
import { verifiedIdentityFor } from '@/lib/kyc/identity'

/**
 * Shared pieces of the call routes (src/app/api/calls/**, src/app/api/conversations/[id]/call*). Kept tiny: every
 * decision lives in session.ts / eligibility.ts, where it is tested.
 */

/** The call this person is a participant of, or a 404 — never a 403, which would confirm the id exists. */
export async function participantCall(callId: string, profileId: string): Promise<{ row: CallSessionRow; role: CallRole }> {
  if (!callIdSchema.safeParse(callId).success) throw new ApiError('not_found', 404)
  const row = await loadCall(callId)
  const role = row ? roleOf(row, profileId) : null
  if (!row || !role) throw new ApiError('not_found', 404)
  return { row, role }
}

export const tabBody = z.strictObject({ tabId: tabIdSchema })

export interface PeerCard {
  name: string | null
  avatarUrl: string | null
  verified: boolean
  memberSince: string | null
  side: 'buyer' | 'seller' | null
}

/**
 * Who the other person is, for a call screen (DESIGN.md v3 §4: role + listing first, so a stranger cannot pose as eno):
 * display name, avatar, verified identity yes/no, member since, and which side of the listing they are on. ONE builder
 * for both screens — the callee's (GET /api/calls/:id) and the caller's (GET /api/conversations/:id/call).
 */
export async function peerCard(peerId: string | null, buyerProfileId: string | null): Promise<PeerCard> {
  if (!peerId) return { name: null, avatarUrl: null, verified: false, memberSince: null, side: null }
  const [peer, identity] = await Promise.all([
    db.profile.findUnique({ where: { id: peerId }, select: { displayName: true, email: true, avatarUrl: true, createdAt: true } }),
    verifiedIdentityFor(peerId),
  ])
  return {
    name: peer?.displayName || maskEmailHandle(peer?.email) || null,
    avatarUrl: peer?.avatarUrl ?? null,
    verified: identity !== null,
    memberSince: peer?.createdAt.toISOString() ?? null,
    side: buyerProfileId === null ? null : buyerProfileId === peerId ? 'buyer' : 'seller',
  }
}

/**
 * A JSON body of at most `maxChars`, parsed — or a 400 bad_request. The read STOPS at the cap (round-6 review): a
 * chunked body declares no length, and `req.text()` would buffer all of it before anything could be checked. Bytes
 * are capped at 3 per character (the most UTF-8 spends on one UTF-16 unit), then the decoded text is held to maxChars.
 */
export async function readJsonCapped(req: Request, maxChars: number): Promise<unknown> {
  const maxBytes = maxChars * 3
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) throw new ApiError('bad_request', 400)
  const chunks: Uint8Array[] = []
  if (req.body) {
    const reader = req.body.getReader()
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch((e) => logError(e, { op: 'calls.body.cancel' }))
        throw new ApiError('bad_request', 400)
      }
      chunks.push(value)
    }
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length > maxChars) throw new ApiError('bad_request', 400)
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError('bad_request', 400)
  }
}

/**
 * A capability report from a phone, bounded like every opaque field of the protocol (it is stored and relayed): an
 * oversized one is a 400 at the door, never a ZodError thrown inside the accept transaction (commit-gate review).
 */
export const boundedCapabilities = z.unknown().optional().refine((v) => {
  if (v === undefined) return true
  try { return JSON.stringify(v).length <= MAX_OPAQUE_JSON_LENGTH } catch { return false }
}, { message: 'capabilities too large' })
export { sasNonceSchema, tabIdSchema }

/** What a phone needs to reach the relay. The handle (for revocation) never leaves the box. */
export function relayForClient(grant: { provider: string; iceServers: unknown; expiresAt: number }) {
  return { provider: grant.provider, iceServers: grant.iceServers, iceTransportPolicy: 'relay' as const, expiresAt: grant.expiresAt }
}

/**
 * A participant ends the call (hang-up, the engine's own 'lost' / 'media_failed' / 'sas_mismatch', a pagehide
 * beacon). Returns the row as it was, or null when it had already ended (idempotent).
 *   · only what a peer may say of its own end (protocol.ts PEER_END_REASONS) is kept — 'declined' after an answer,
 *     or a reason only the box decides, would be a stranger putting words in the box's mouth: it becomes 'hangup',
 *     the same rule the receiving reducer applies (commit-gate review C1);
 *   · while ringing, the caller's end is 'cancelled' and the callee's is a decline from any of their tabs (none is
 *     bound yet); once answered, only the bound tab of each side may end it (wrong_tab).
 */
export async function endByParticipant(row: CallSessionRow, role: CallRole, profileId: string, tabId: string, claimed: CallEndReason): Promise<EndedCallRow | null> {
  if (row.state === 'ended') return null
  if (role === 'caller' && tabId !== row.caller_tab) throw new ApiError('wrong_tab', 409)
  if (row.state === 'ringing') {
    // ⚠️ Only FROM ringing: an accept that commits between the read above and this end must not be ended as a cancel or
    // a decline (and, for the callee, without the bound-tab check) — commit-gate review.
    const reason: CallEndReason = role === 'caller' ? 'cancelled' : 'declined'
    const ended = await endCall({ callId: row.id, reason, profileId, fromStates: ['ringing'] })
    if (ended) {
      after(() => afterCallEnded(ended, reason))
      return ended
    }
    const now = await loadCall(row.id)
    if (!now || now.state === 'ended') return null
    row = now // it was answered meanwhile: end it as an answered call, with the answered call's checks
  }
  if (role === 'callee' && tabId !== row.callee_tab) throw new ApiError('wrong_tab', 409)
  const reason: CallEndReason = PEER_END_REASONS.has(claimed) ? claimed : 'hangup'
  const ended = await endCall({ callId: row.id, reason, profileId, fromStates: ['accepted', 'ready', 'connected'] })
  if (ended) after(() => afterCallEnded(ended, reason))
  return ended
}
