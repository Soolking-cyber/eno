import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { isReactionEmoji } from '@/lib/reactions'

/**
 * TOGGLE ONE PERSON'S REACTION ON ONE MESSAGE.
 *
 * ⛔ TOGGLE, NOT ADD. Tapping a reaction you already left REMOVES it — that is the interaction
 * everyone expects from Zalo, Messenger and iMessage, and it is also what keeps the table from
 * growing without bound. The database enforces it too, via the unique index on
 * (messageId, profileId, emoji): if a double-tap races itself, the second insert conflicts instead
 * of writing a duplicate the UI would then render twice.
 *
 * ⚠️ THE MEMBERSHIP GATE IS THE POINT OF THIS ROUTE EXISTING AT ALL. A reaction id is a message id,
 * and message ids are cuids that appear in one thread; without the check below, a signed-in
 * stranger could decorate any conversation on the site. The gate is deliberately NOT filtered by
 * buyerDeletedAt/sellerDeletedAt — DELETE on a conversation is a per-user hide from the inbox, not
 * a revocation, and the thread reappears when the other party replies. Same reasoning, and the same
 * wording, as the translate route's gate; if that one changes, this one changes with it.
 *
 * ⚠️ MISSING AND FORBIDDEN ARE ONE ANSWER. Returning 404 for a message id that does not exist and
 * 403 for one that does would let a signed-in stranger test ids for existence by comparing the two.
 * The same oracle was found and closed on the trip-request endpoint; do not split these.
 */

const bodySchema = z.object({
  // Shape only — membership in the catalogue is checked below so the failure is legible. A zod
  // enum over 47 glyphs would produce an unreadable error and duplicate the allow-list.
  emoji: z.string().min(1).max(16),
})

export const POST = route(
  {
    auth: 'profile',
    body: bodySchema,
    /**
     * ⚠️ Generous, because reacting is a rapid-fire interaction — someone catching up on a thread
     * legitimately taps a dozen hearts in a few seconds, and a tight limit would make the UI
     * silently stop responding mid-scroll. It is a ceiling on abuse, not a pace-setter.
     */
    rateLimit: { bucket: 'message-react', limit: 240, window: '1 h' },
  },
  async ({ profile, params, body }) => {
    const messageId = params.id
    if (!messageId) throw new ApiError('bad_request', 400)

    // ⛔ THE ALLOW-LIST GATE. `emoji` is user-controlled text that both participants then render;
    // see src/lib/reactions.ts for why this column is closed rather than free-form.
    if (!isReactionEmoji(body.emoji)) throw new ApiError('bad_request', 400)

    const message = await db.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversation: { select: { buyerProfileId: true, sellerProfileId: true } } },
    })
    const convo = message?.conversation
    const isParticipant = !!convo && (convo.buyerProfileId === profile.id || convo.sellerProfileId === profile.id)
    // One answer for missing and forbidden — see the oracle note in the header.
    if (!isParticipant) throw new ApiError('forbidden', 403)

    /**
     * ⚠️ KNOWN AND ACCEPTED — TWO SIMULTANEOUS TAPS FROM AN EMPTY STATE LEAVE ONE ROW, not zero.
     * Both requests delete nothing, one insert wins and the other hits P2002, so the pair of
     * toggles nets to "on" rather than back to "off". Reviewer-derived and correct. Fixing it means
     * serialising per (message, profile) in a transaction to buy strict parity on a double-tap
     * nobody performs deliberately, and the result — the reaction is on — is the one the user's
     * first tap asked for. The counts returned are always read after the write, so the client
     * converges on the truth either way.
     *
     * ⚠️ DELETE-THEN-COUNT, AND THE `count` IS WHAT DECIDES. `deleteMany` returns how many rows it
     * removed, so one round trip answers "did they already have this?" without a separate read that
     * a concurrent tap could invalidate between the two. A `findFirst` + branch would be the race
     * the unique index exists to catch.
     */
    const removed = await db.messageReaction.deleteMany({
      where: { messageId, profileId: profile.id, emoji: body.emoji },
    })

    if (removed.count === 0) {
      try {
        await db.messageReaction.create({
          data: { messageId, profileId: profile.id, emoji: body.emoji },
        })
      } catch (err) {
        /**
         * ⛔ ONLY THE UNIQUENESS RACE IS SWALLOWED. The first version caught EVERYTHING, which a
         * reviewer correctly called overbroad: a foreign-key violation, a dead connection or a
         * failing database would all have been reported to the client as a successful reaction.
         * P2002 is Prisma's unique-constraint code, and it means the same person's second tap
         * landed first — the reaction they wanted exists, so the fresh counts below are the honest
         * answer. Everything else is a real failure and must surface.
         */
        if ((err as { code?: string })?.code !== 'P2002') throw err
      }
    }

    return { reactions: await readReactions(messageId, profile.id) }
  },
)

/** Everything the bubble needs to draw its reaction row, for one message. */
export async function readReactions(messageId: string, viewerProfileId: string) {
  const rows = await db.messageReaction.findMany({
    where: { messageId },
    select: { emoji: true, profileId: true },
  })
  const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean }>()
  for (const row of rows) {
    const entry = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false }
    entry.count += 1
    if (row.profileId === viewerProfileId) entry.mine = true
    byEmoji.set(row.emoji, entry)
  }
  // Most-reacted first, then stable by glyph so two equal counts never swap places between renders
  // and make the row appear to shuffle itself.
  return [...byEmoji.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
}
