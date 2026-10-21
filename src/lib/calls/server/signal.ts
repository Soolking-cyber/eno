import type { ClientEvent, IceCandidate } from '../protocol'
import { sanitizeCandidateLine, sanitizeSdp, validateRemoteSdp } from '../sdp-guard'

/**
 * In-app calls — the box's pass over a phone's event BEFORE it is stored or relayed (DESIGN.md v3 §3.2 step 4,
 * sdp-guard.ts). Pure, so the route stays a thin shell and this is pinned by tests.
 *
 *   · offer / answer: the description must pass validateRemoteSdp (one fingerprint, one BUNDLE, no decoys — refused,
 *     never repaired), then sanitizeSdp rebuilds every candidate line from validated fields and neutralises any c= /
 *     a=rtcp address that is not one of THIS call's relays.
 *   · candidates: each is rebuilt by sanitizeCandidateLine or dropped; the empty end-of-candidates marker is dropped
 *     too (half-trickle never needs it, and one that overtakes real candidates makes Firefox ignore them —
 *     negotiation review).
 * ⚠️ THE PHONE'S OWN CHECK IS THE ONE THAT COUNTS. The box is exactly the party the safety code distrusts; this pass is
 * hygiene that keeps junk and stray IPs out of call_negotiation and realtime.messages, and gives an honest phone a
 * clear refusal. The receiving engine validates every description again before applying it.
 * ⚠️ ZERO SURVIVING CANDIDATES IS REPORTED, NOT SILENT (sdp-guard review): a wrong relay allow-list drops every
 * candidate and every call then fails with nothing in the logs. `lostAll` tells the route to log it.
 */

export type SanitizedEvent =
  | { ok: true; event: Exclude<ClientEvent, { kind: 'end' }> | null; before: number; after: number; lostAll: boolean }
  | { ok: false; error: 'invalid_sdp' }

const countCandidates = (sdp: string) => (sdp.match(/^a=candidate:/gm) ?? []).length

export function sanitizeClientEvent(event: Exclude<ClientEvent, { kind: 'end' }>, allowedRelayIps: ReadonlySet<string>): SanitizedEvent {
  const opts = { allowedRelayIps }
  if (event.kind === 'offer' || event.kind === 'answer') {
    if (!validateRemoteSdp(event.payload.sdp).ok) return { ok: false, error: 'invalid_sdp' }
    const sdp = sanitizeSdp(event.payload.sdp, opts)
    const before = countCandidates(event.payload.sdp)
    const after = countCandidates(sdp)
    const payload = { ...event.payload, sdp }
    return { ok: true, event: { ...event, payload } as typeof event, before, after, lostAll: before > 0 && after === 0 }
  }
  if (event.kind === 'candidates') {
    const kept: IceCandidate[] = []
    for (const c of event.payload.candidates) {
      if (c.candidate === '') continue
      const line = sanitizeCandidateLine(c.candidate, opts)
      if (line !== null) kept.push({ ...c, candidate: line })
    }
    const before = event.payload.candidates.filter((c) => c.candidate !== '').length
    if (kept.length === 0) return { ok: true, event: null, before, after: 0, lostAll: before > 0 }
    return { ok: true, event: { ...event, payload: { candidates: kept } }, before, after: kept.length, lostAll: false }
  }
  return { ok: true, event, before: 0, after: 0, lostAll: false }
}
