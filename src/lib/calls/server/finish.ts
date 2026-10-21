import 'server-only'
import type { CallEndReason } from '../types'
import { revokeRelayCredential } from './relay'
import { RING_OVER_TEXT, replaceRingPush, writeCallRecord } from './cards'
import type { EndedCallRow } from './session'

/**
 * What follows a call's end, once the transition committed (session.ts endCall / sweepStale return the row as it
 * was): both relay credentials revoked — the TTL is only the backstop — the record written to the thread, and a call
 * that ended while RINGING has its lock-screen notification replaced (cards.ts — by the missed-call push, else here).
 * Best-effort throughout; run it in after() so a slow relay API never delays the response that ended the call.
 */
export async function afterCallEnded(before: EndedCallRow, reason: CallEndReason): Promise<void> {
  await Promise.all([
    revokeRelayCredential(before.relay_provider, before.caller_relay_user),
    revokeRelayCredential(before.relay_provider, before.callee_relay_user),
  ])
  const replaced = await writeCallRecord(before, reason)
  if (before.state === 'ringing' && !replaced) await replaceRingPush(before, RING_OVER_TEXT, reason !== 'blocked')
}
