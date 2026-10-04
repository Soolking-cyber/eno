/**
 * 'ĐÃ XEM / ĐÃ GỬI' (inbox-07) — the thread's one read receipt, and the ONE rule that keeps it honest.
 *
 * The server's `counterpartSeen` is the OTHER side's unread counter at zero (GET /api/conversations/[id]):
 * the only read receipt the schema keeps. It is a claim about the thread AT THE MOMENT OF THAT READ, and the
 * server says which moment: `seenAsOf`, its clock taken just before it read the counters. So:
 *   · the receipt sits under my NEWEST message only — there "seen" and "everything seen" are the same claim;
 *   · it says 'Đã xem' only if that message was created by `seenAsOf`. Anything of mine that appeared after
 *     the read — a text, a quick reply, an opener, a retry, an offer card, whatever path appended it without
 *     a refetch, today's or a future one — is outside what the read could vouch for, so it says 'Đã gửi'
 *     until a later fetch covers it.
 * ⚠️ ONE BOUND, NOT A LIST OF RESETS. The first fix reset the flag in the text send only, and review found the
 * next path; a bound on the claim itself cannot miss a path. Both clocks are the server's (seenAsOf and a
 * confirmed message's createdAt), so device clock skew cannot move it.
 * Pure, so it is pinned by a test rather than by rendering the thread page.
 */

export type SeenMsg = { id: string; mine: boolean; createdAt?: string; pending?: boolean; failed?: boolean; deleted?: boolean }

/**
 * The receipt — the message it sits under and what it says — or null for no receipt at all: my newest
 * message, once the server has it. A pending or failed bubble already says so in its own meta line, and a
 * recalled one has nothing left to have been seen. A payload without `counterpartSeen` (a cached thread from
 * an older build) shows nothing rather than guessing; one without `seenAsOf` cannot bound the claim and so
 * never says 'Đã xem'.
 */
export function seenReceipt(
  messages: readonly SeenMsg[],
  counterpartSeen: boolean | undefined,
  seenAsOf: string | undefined,
): { anchorId: string; seen: boolean } | null {
  if (typeof counterpartSeen !== 'boolean') return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m.mine) continue
    if (m.pending || m.failed || m.deleted || String(m.id).startsWith('temp-')) return null
    const created = m.createdAt ? Date.parse(m.createdAt) : NaN
    const asOf = seenAsOf ? Date.parse(seenAsOf) : NaN
    return { anchorId: m.id, seen: counterpartSeen && created <= asOf }
  }
  return null
}
