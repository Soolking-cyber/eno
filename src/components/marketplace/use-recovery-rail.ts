import { useState } from 'react'
import type { RelatedRail } from '@/lib/core/related-rail'

/**
 * WHICH RAIL FOLLOWS A SPARSE ANSWER — decided ONCE PER ANSWER, from the answer itself (UI climb 2026-11-09, hunt #9).
 * /api/listings carries `related` (the rest of the answer's category, src/lib/core/related-rail.ts) in the same response as
 * the rows. The explorer copies rows into state in a passive effect, a render after the payload lands, so `related` is
 * read here only when the payload's rows ARE the rows on screen (same ids, same order):
 *   · 'related' — "More in <category>"; · 'trending' — the answer has none (today's ForYouRail);
 *   · 'unknown' — rows that have NEVER had their answer in this mount (a full-reload Back restoring a snapshot before its
 *     fetch): the explorer shows NO rail rather than Trending, so a rail never changes kind under the reader (both plan
 *     reviewers' counterexamples, 2026-11-09).
 * ⚠️ THE DECISION FOLLOWS THE ROWS ON SCREEN, NOT `answer` OF THE MOMENT: in the render between a new payload and its rows
 * (or while react-query holds no data for rows already decided), the rows keep their own decision — the grid shows the same
 * rows, so rail and grid stay one answer. Other words, filters or language with the same ids re-decide when their payload
 * reaches the rows.
 * ⛔ PINNED PER ANSWER: the first decision for an answer (its own provenance, `fetchedFor.sig`, plus its ids) holds until
 * the rows change. A background refetch of the same key can return the same rows with re-ranked related cards; adopting
 * them would reshuffle the rail under a grid that did not move. A new answer (other words, filters or answer-language) is
 * a new decision. The pin is set during render (React's derived-state pattern), so it commits with the rows it belongs to.
 * ⚠️ THE TRADE-OFF, CHOSEN (commit review, 2026-11-09): a card that left the market between the answer and a refetch stays
 * in the pinned rail until the rows change. "Removals only" cannot be told from a re-rank — a card absent from the refreshed
 * twelve may simply have ranked thirteenth — and its listing page states its own status when opened.
 */
export type RecoveryRail = { kind: 'related'; related: RelatedRail } | { kind: 'trending' } | { kind: 'unknown' }

type Answer = { listings?: readonly { id: string }[]; related?: RelatedRail | null; fetchedFor?: { sig?: string } } | null | undefined

const idsOf = (rows: readonly { id: string }[]) => rows.map((r) => r.id).join(',')

export function useRecoveryRail(answer: Answer, shown: readonly { id: string }[]): RecoveryRail {
  const ids = idsOf(shown)
  const decidable = !!answer?.listings && idsOf(answer.listings) === ids
  const key = decidable ? `${answer?.fetchedFor?.sig ?? ''}|${ids}` : null
  const [pin, setPin] = useState<{ key: string; ids: string; related: RelatedRail | null } | null>(null)
  let current = pin
  if (key !== null && pin?.key !== key) {
    current = { key, ids, related: answer?.related ?? null }
    setPin(current)
  }
  if (!current || current.ids !== ids) return { kind: 'unknown' }
  return current.related ? { kind: 'related', related: current.related } : { kind: 'trending' }
}
