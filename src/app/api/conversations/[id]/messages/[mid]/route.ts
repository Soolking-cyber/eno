import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * RECALL A MESSAGE — the chat "Delete" action. Only your OWN, only in a conversation you're part
 * of, and only a plain text message.
 *
 * ⛔ THIS USED TO BE A HARD DELETE, AND IT HAD ZERO UI CALL SITES. That combination is the only
 * reason it was safe: nothing could reach it. Wiring a Delete button to it as written would have
 * shipped an evidence-destruction primitive into a marketplace that runs a dispute center —
 * Report.conversationId is set whenever a report is filed FROM a chat, and an admin reads that
 * thread to adjudicate a scam or harassment case. The party most motivated to delete their messages
 * is the party about to be reported for them. Both external reviewers reached this independently
 * before a line of UI existed.
 *
 * So the row STAYS and only `deletedAt` is stamped. `body` is untouched in the database and
 * redacted out of both participants' responses by serializeMessage (src/lib/messages.ts) — the
 * single place a Message row becomes a wire message, which is why redaction cannot be forgotten at
 * a call site.
 *
 * ⛔ TEXT ONLY. An 'offer' carries live accept/decline/counter state that the offer routes and the
 * thread both read, and every card kind ('visa_step', 'trip_step', …) is a step in a running
 * wizard. Recalling either would strand a flow rather than tidy a conversation, so they are refused
 * (409) instead of being hidden into an inconsistent state.
 *
 * ⚠️ ALREADY-RECALLED IS A SUCCESS, NOT A CONFLICT. A double tap on a flaky connection must not
 * report failure for work that is done — the updateMany predicate carries `deletedAt: null`, and a
 * zero-row result is answered 204 exactly like the first call.
 *
 * WS6 — `auth: 'userId'`, not 'profile': the row is only ever compared against `senderProfileId`,
 * so the Profile row is never read. Branches held: guest → 401 auth_required · unknown mid, or a
 * mid belonging to another conversation → 404 not_found · someone else's message → 403 forbidden ·
 * an offer or a card → 409 not_recallable · success → 204 with an EMPTY body, returned as a
 * Response so the wrapper does not JSON-wrap it.
 */
export const DELETE = route({ auth: 'userId' }, async ({ params, userId }) => {
  const { id, mid } = params

  const msg = await db.message.findUnique({
    where: { id: mid },
    select: { id: true, conversationId: true, senderProfileId: true, kind: true, deletedAt: true },
  })
  if (!msg || msg.conversationId !== id) throw new ApiError('not_found', 404)
  if (msg.senderProfileId !== userId) throw new ApiError('forbidden', 403)
  if (msg.kind !== 'text') throw new ApiError('not_recallable', 409)

  await db.$transaction(async (tx) => {
    /**
     * ⛔ THE STAMP IS THE GATE FOR EVERYTHING BELOW IT. Reviewer-caught: with the side effects run
     * unconditionally, a double-tap or a retried DELETE re-ran them against a message that was
     * already recalled — rewriting the inbox preview a second time and, in the version that still
     * adjusted it, decrementing the unread badge once per request. `deletedAt: null` in the
     * predicate makes the stamp a compare-and-set, and a zero-row result means another request got
     * here first: the work is done, so return without repeating it. The response is still 204 —
     * "already recalled" is a success, not a conflict.
     */
    /**
     * ⛔ READ BEFORE THE STAMP, OR THE ANSWER IS ALWAYS "no". This is "was this message the one the
     * inbox preview was showing?", and the only way to ask it is over the messages that were still
     * VISIBLE a moment ago — after the stamp below, this row is not one of them.
     *
     * ⚠️ IT MUST FILTER ON `deletedAt: null`, AND THE FIRST VERSION DID NOT. Written against ALL
     * rows, it answered "was this the newest row ever written", which is a different question and
     * wrong in the obvious chain: recall the newest message (preview falls back to the one before
     * it), then recall THAT one — it is not the newest row, so the preview was left alone and both
     * inboxes kept displaying the text of a message that had just been recalled. Caught by testing
     * two recalls in a row rather than one.
     */
    const previewedByThis = (await tx.message.findFirst({
      where: { conversationId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }))?.id === mid

    const stamped = await tx.message.updateMany({ where: { id: mid, deletedAt: null }, data: { deletedAt: new Date() } })
    if (stamped.count !== 1) return

    /**
     * ⚠️ THE TALLIES GO WITH THE TEXT. A tombstone reading "❤️ 3" is a fossil of the message it is
     * meant to have removed — the counts describe content nobody can see any more, and they would
     * also keep feeding the global top-5 aggregate. serializeMessage drops them from the response
     * as well; this is what stops them accumulating in the table.
     *
     * ⚠️ A REACTION LANDING CONCURRENTLY CANNOT SURVIVE THIS. The reactions route takes a real row
     * write on this Message (conditioned on `deletedAt: null`) before inserting, so it either
     * commits before the stamp above — and is deleted here — or finds the row already recalled and
     * is refused. See the guard in api/messages/[id]/reactions.
     */
    await tx.messageReaction.deleteMany({ where: { messageId: mid } })

    /**
     * THE INBOX PREVIEW. Recalling the newest message must not leave its text sitting in both
     * parties' conversation lists — which is exactly where a recall is most visible.
     *
     * ⛔ COMPARE-AND-SET ON `lastMessageAt`, NOT A BLIND WRITE. Reviewer-caught race: a message sent
     * between the read below and this write would have its preview overwritten by the OLDER message
     * this recall fell back to — and `lastMessageAt` would move BACKWARDS, which reorders both
     * inboxes and can re-hide a thread the other party had deleted (the hide compares against that
     * column). Re-asserting the value we read means a concurrent send simply wins: this matches
     * zero rows and leaves the newer preview alone.
     *
     * ⛔ AND ONLY WHEN THIS MESSAGE IS THE ONE THE PREVIEW WAS SHOWING — see `previewedByThis`
     * above. If it was not, the preview is quoting some OTHER message and rewriting it is pure
     * damage, which is how the empty-card-body bug below was reachable at all.
     *
     * ⚠️ `lastMessageAt` IS NEVER WRITTEN HERE AT ALL — see the note on the `data` below. One
     * reviewer asked for both denormalised fields to be reset when nothing is left; the column is
     * NOT NULL (it defaults to now() and orders the whole inbox), so there is nothing to reset it
     * to. Only the text is dropped. It is still the CAS predicate, which is what makes a concurrent
     * send win this write.
     */
    if (previewedByThis) {
      const convo = await tx.conversation.findUnique({ where: { id }, select: { lastMessageAt: true } })
      const last = await tx.message.findFirst({
        where: { conversationId: id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true },
      })
      if (convo) {
        await tx.conversation.updateMany({
          where: { id, lastMessageAt: convo.lastMessageAt },
          /**
           * ⚠️ A CARD HAS NO BODY TO FALL BACK TO. Reviewer-caught: every structured message
           * ('offer', 'visa_step', 'trip_quote', …) is stored with an EMPTY body — its inbox line
           * is a bilingual sentence composed at send time and written straight to
           * lastMessageText, and nothing in this row can reconstruct it. Blindly slicing
           * `last.body` therefore replaced "Đã gửi đề nghị · Sent an offer" with an empty string
           * in both inboxes. Null instead: the conversation list falls back to its own generic
           * line, which is vague rather than blank, and the next message corrects it.
           */
          /**
           * ⛔ ONLY THE TEXT MOVES. `lastMessageAt` IS LEFT WHERE IT IS. An earlier version wound it
           * back to the surviving message's timestamp, which a reviewer showed is damage in two
           * directions: it reorders both inboxes for a deletion, and — because the per-user "delete
           * conversation" hide is a comparison against this column — it can RE-HIDE a thread the
           * other party had hidden and that had legitimately resurfaced, while their unread counter
           * (deliberately untouched, see below) stays incremented. A dangling badge on a hidden
           * thread is worse than a thread whose sort position reflects when something last happened
           * in it, which a recall genuinely is.
           */
          data: last?.body ? { lastMessageText: last.body.slice(0, 140) } : { lastMessageText: null },
        })
      }
    }

    /**
     * ⛔ THE UNREAD BADGE IS DELIBERATELY LEFT ALONE, AND THE FIRST VERSION OF THIS ROUTE WAS WRONG
     * TO TOUCH IT. It decremented the recipient's counter under a `gt: 0` guard, reading "some
     * unread remain" as "this one is among them". A reviewer produced the counterexample in one
     * line: A is sent and READ (counter 0), B is sent (counter 1), A is recalled — the decrement
     * takes the counter to 0 and B's badge is gone. There is no per-message read marker in this
     * schema (the counters are zeroed wholesale when the thread is opened), so no correct decrement
     * is available.
     *
     * The cost of leaving it: recalling a message the other party never read can leave a badge for
     * a message that no longer renders. They open the thread — which is what a badge is for — the
     * counter is zeroed, and it is gone. Over-counting sends someone to look at a conversation;
     * under-counting hides a real message. Those are not symmetric.
     */
  })

  return new NextResponse(null, { status: 204 })
})
