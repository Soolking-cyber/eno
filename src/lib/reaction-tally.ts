import { db } from '@/lib/db'
import { TOP_REACTION_COUNT } from '@/lib/reactions'

/**
 * THE GLOBAL TOP-5 — which reactions eno.vn actually uses, measured across every thread on the
 * site. This is what makes the quick bar the owner's *"top 5 most used emojis"* rather than five
 * emoji somebody guessed at in a constant.
 *
 * ⚠️ SERVER ONLY. It touches the database; src/lib/reactions.ts is the client-safe catalogue and
 * must stay importable from a component. Keeping them in separate files is what stops `db` being
 * pulled into the chat bundle by an innocent-looking import of `reactionFor`.
 *
 * ⛔ NOT A pg_cron JOB, THOUGH ONE WAS PLANNED. The aggregate is a single GROUP BY over one small
 * table behind an index, and it runs at most once an hour per instance — a cron job, a table to
 * hold its output and a schedule to keep alive is machinery in exchange for nothing at this size.
 * The moment the table is big enough for the query to be felt, this function is the one place that
 * changes: swap the body for a read of a cron-refreshed table and every caller is unaffected.
 *
 * ⚠️ THE CACHE IS PER-INSTANCE AND THAT IS FINE. Cloud Run runs several containers, so two users
 * can briefly see two different rankings of a decorative bar. Both reviewers were asked directly
 * and both said the incoherence does not matter here; paying for a shared cache to synchronise
 * which five emoji appear first would be the wrong trade.
 */

const TTL_MS = 60 * 60 * 1000

let cached: { at: number; emoji: string[] } | null = null

/**
 * Most-used reaction glyphs, most-used first. Never throws: a failed aggregate returns an empty
 * list, and `topReactions()` tops that up from the fallback set, so the bar is always five wide.
 */
export async function globalTopReactions(): Promise<string[]> {
  const now = Date.now()
  if (cached && now - cached.at < TTL_MS) return cached.emoji

  try {
    /**
     * ⚠️ RECALLED MESSAGES CANNOT VOTE. Recalling a message deletes its reaction rows outright (see
     * the recall route), so there is nothing here to filter — this is stated because the invariant
     * lives in TWO places and a future "restore" feature that stopped deleting them would silently
     * start feeding the ranking with reactions to text nobody can read.
     */
    const rows = await db.messageReaction.groupBy({
      by: ['emoji'],
      _count: { emoji: true },
      orderBy: { _count: { emoji: 'desc' } },
      take: TOP_REACTION_COUNT,
    })
    cached = { at: now, emoji: rows.map((r) => r.emoji) }
  } catch {
    /**
     * ⚠️ THE FAILURE IS CACHED TOO, DELIBERATELY. Without this the thread endpoint would re-run a
     * failing aggregate on every single open — turning a decorative ranking into a load amplifier
     * at exactly the moment the database is unhappy. An empty result is a correct answer here.
     */
    cached = { at: now, emoji: [] }
  }
  return cached.emoji
}
