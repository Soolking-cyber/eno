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
      select: { id: true, deletedAt: true, conversation: { select: { buyerProfileId: true, sellerProfileId: true } } },
    })
    const convo = message?.conversation
    const isParticipant = !!convo && (convo.buyerProfileId === profile.id || convo.sellerProfileId === profile.id)
    /**
     * ⚠️ A RECALLED MESSAGE JOINS THE SAME ANSWER, and it belongs here rather than in its own
     * branch. Recalling deletes the existing tallies (see the recall route), so a reaction landing
     * afterwards would resurrect a count under a tombstone — and a distinct status code would tell
     * the caller "this message exists but was taken back", which is precisely the fact a recall
     * removes. Missing, forbidden and recalled are one 403.
     */
    if (!isParticipant || message?.deletedAt) throw new ApiError('forbidden', 403)

    /**
     * ⛔ THE RECALL RACE — AND THE FIRST FIX FOR IT WAS ALSO WRONG. The `deletedAt` read above runs
     * before the write, so a recall committing in between left a reaction attached to a recalled
     * message: it survives the recall's own cleanup, resurfaces under a tombstone, and feeds the
     * global top-5 with a reaction to text nobody can read.
     *
     * The first attempt guarded it with a bare `updateMany` outside any transaction — which a
     * reviewer correctly refuted: that statement is its own autocommitted transaction, so the row
     * lock it takes is RELEASED the instant it returns, before the insert below ever runs. It read
     * like a lock and was a no-op. The guard only works inside the same transaction as the write.
     *
     * ⚠️ WRITING `deletedAt: null` BACK TO NULL IS THE POINT, AND IT IS NOT A NO-OP. A findFirst
     * would not lock the row under READ COMMITTED — it would re-read the same pre-recall snapshot
     * and prove nothing. An UPDATE is a real row write, so it takes a genuine lock held to COMMIT,
     * and the WHERE clause becomes a compare-and-set: if the recall got there first this matches
     * zero rows and the reaction is refused. This repo learned the read-does-not-lock lesson the
     * expensive way in the visa capture race; the trip-card insert uses the same idiom.
     *
     * ⚠️ NO COLUMN CHANGES VALUE, so nothing that watches the row is disturbed: Message has no
     * @updatedAt and nothing keys off it.
     *
     * ⚠️ KNOWN AND ACCEPTED — TWO SIMULTANEOUS TAPS FROM AN EMPTY STATE LEAVE ONE ROW, not zero.
     * Both delete nothing, one insert wins and the other hits P2002, so the pair of toggles nets to
     * "on" rather than back to "off". The result is the one the user's first tap asked for, and the
     * counts are always read after the write, so the client converges either way.
     *
     * ⚠️ DELETE-THEN-COUNT, AND THE `count` IS WHAT DECIDES. `deleteMany` returns how many rows it
     * removed, so one round trip answers "did they already have this?" without a separate read a
     * concurrent tap could invalidate between the two.
     */
    try {
      await db.$transaction(async (tx) => {
        const alive = await tx.message.updateMany({ where: { id: messageId, deletedAt: null }, data: { deletedAt: null } })
        if (alive.count !== 1) throw new ApiError('forbidden', 403)

        const removed = await tx.messageReaction.deleteMany({
          where: { messageId, profileId: profile.id, emoji: body.emoji },
        })
        if (removed.count === 0) {
          await tx.messageReaction.create({
            data: { messageId, profileId: profile.id, emoji: body.emoji },
          })
        }
      })
    } catch (err) {
      /**
       * ⛔ THE P2002 CATCH HAD TO MOVE OUT HERE, AND THAT IS A CONSEQUENCE OF THE TRANSACTION, NOT
       * a style choice. Postgres aborts the WHOLE transaction on a constraint violation — catching
       * P2002 inside and carrying on would make every following statement fail with "current
       * transaction is aborted". Out here the transaction has already rolled back (including the
       * no-op guard write, which changed nothing), and the state the caller wanted — their reaction
       * exists, inserted by their own racing request — is already true.
       *
       * ⛔ ONLY THE UNIQUENESS RACE IS SWALLOWED. An earlier version caught EVERYTHING, which a
       * reviewer called overbroad: a foreign-key violation, a dead connection or a failing database
       * would all have been reported to the client as a successful reaction. ApiError is re-thrown
       * so the 403 above still reaches the caller.
       */
      if (err instanceof ApiError) throw err
      if ((err as { code?: string })?.code !== 'P2002') throw err
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
