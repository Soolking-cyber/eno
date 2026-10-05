'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { SaleConfirmPrompt, type SaleConfirmStatus } from './sale-confirm-prompt'

/**
 * ── <SaleQuestions> — <SaleConfirmPrompt> wired to the server, in the BUYER's thread ─────────────────
 *
 * The trade loop's buyer half (src/lib/trade-loop.ts). When a seller names this person in "Who bought
 * it?", POST /api/listings/[id]/sold sends them ONE notification and push that open their thread with
 * that seller — and this is what they find there: "Minh says you bought the Honda Vision for 11.200.000
 * đ" → Yes / No, one tap each.
 *
 *   · WHAT IS ASKED — GET /api/conversations/[id]/sale-question: every open question from this thread's
 *     seller to the viewer, by SELLER rather than by the listing the thread shows now (a thread is
 *     retargeted to whatever the buyer asked about last; the sold item is often not it).
 *   · THE ANSWER — POST /api/listings/[listingId]/sale-confirmation { answer, price }. `price` is the
 *     number the buyer was SHOWN: if the seller has changed it since, the server answers not_actionable
 *     and the question is fetched again — nobody confirms a figure they did not see.
 *
 * The prompt is props-only and states its contracts on its props; this file keeps them:
 *   · `pending` is set SYNCHRONOUSLY in the tap's handler and cleared when the write settles;
 *   · `errorMessage` describes the LATEST attempt — cleared the moment a retry starts;
 *   · a recorded answer is never re-asked: a settled card STAYS (its acknowledgement is the proof the
 *     tap landed) even when a refetch no longer lists the question, and a "No" is persisted before the
 *     card says "we will not ask about this one again".
 *
 * `refreshKey`: re-ask the server when the thread changes underneath (the page passes its listing's id +
 * status, so a sale that lands while the buyer is looking at the thread appears without a reload).
 * Mount it with `key={conversationId}` — a different thread is a different set of questions.
 */

/**
 * What the page may assume about this thread's questions:
 *  · 'unknown' — not answered yet, or the lookup failed. Assume one MAY be open.
 *  · 'open'    — the seller is asking something the buyer has not answered.
 *  · 'none'    — the server says nothing is being asked (or everything shown has been answered).
 */
export type SaleQuestionsState = 'unknown' | 'open' | 'none'

export type SaleQuestion = {
  saleId: string
  listingId: string
  title: string
  price: number | null
  currency: string
}

type Item = { q: SaleQuestion; status: SaleConfirmStatus; pending: 'confirm' | 'decline' | null; error: string | null }

function isQuestion(x: unknown): x is SaleQuestion {
  if (!x || typeof x !== 'object') return false
  const q = x as Record<string, unknown>
  return (
    typeof q.saleId === 'string' && !!q.saleId &&
    typeof q.listingId === 'string' && !!q.listingId &&
    typeof q.title === 'string' &&
    (q.price === null || (typeof q.price === 'number' && Number.isFinite(q.price))) &&
    typeof q.currency === 'string'
  )
}

/**
 * The server's open questions over what is on screen. An open question keeps its card (its price and
 * title follow the server); a settled card stays even when the server no longer lists it; an open card
 * the server stopped listing (withdrawn by the seller, closed by its window, relisted) goes.
 */
function merge(prev: Item[], fetched: SaleQuestion[]): Item[] {
  const out: Item[] = fetched.map((q) => {
    const had = prev.find((i) => i.q.saleId === q.saleId)
    if (!had) return { q, status: 'asking', pending: null, error: null }
    return had.status === 'asking' ? { ...had, q } : had
  })
  for (const i of prev) {
    if (i.status !== 'asking' && !out.some((o) => o.q.saleId === i.q.saleId)) out.push(i)
  }
  return out
}

export function SaleQuestions({
  conversationId,
  sellerName,
  refreshKey,
  onStateChange,
  className,
}: {
  conversationId: string
  /** The seller's name as this thread shows it — the person the buyer already knows. */
  sellerName: string
  refreshKey?: string
  /** Told what is KNOWN about this thread's questions, so the page can hold back its own post-deal review
   *  card: one question at a time, and the review only after both sides have spoken (canPromptReview).
   *  ⚠️ TRI-STATE ON PURPOSE (commit gate, 2026-10-05): a boolean that started `false` let the review card
   *  render before this lookup answered — and forever when it failed. The page shows that card only on
   *  'none'; 'unknown' (still asking the server, or it could not be reached) keeps it back. */
  onStateChange?: (state: SaleQuestionsState) => void
  className?: string
}) {
  const { tr } = useLanguage()
  const [items, setItems] = useState<Item[]>([])
  // Has the server ANSWERED for this thread yet? Until it has, nothing about its questions is known.
  const [known, setKnown] = useState(false)
  // Only the newest lookup may land: an older reply arriving late must not resurrect a withdrawn question.
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    // ⛔ EVERY LOOKUP STARTS UNKNOWN (gate, 2026-10-05): a refresh after a sale lands asks again, and if that lookup
    // fails, an earlier "none" must not keep the review card up over a question that may now be open.
    setKnown(false)
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/sale-question`)
      if (!res.ok) return
      const data = (await res.json()) as { questions?: unknown }
      if (seq !== seqRef.current) return
      const fetched = Array.isArray(data.questions) ? data.questions.filter(isQuestion) : []
      setItems((prev) => merge(prev, fetched))
      setKnown(true)
    } catch {
      // Nothing to show is the safe failure here: the question stands on the server, and the next open
      // (or the bell's link) asks again. `known` stays false — a failure is never "nothing asked".
    }
  }, [conversationId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // A ref, so a parent passing an inline callback does not re-run this on every render.
  const onStateRef = useRef(onStateChange)
  useEffect(() => {
    onStateRef.current = onStateChange
  }, [onStateChange])
  const asking = items.some((i) => i.status === 'asking')
  // An open card is open whatever the last lookup did; otherwise only a lookup that ANSWERED says "none".
  const state: SaleQuestionsState = asking ? 'open' : known ? 'none' : 'unknown'
  useEffect(() => {
    onStateRef.current?.(state)
  }, [state])

  const update = (saleId: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.q.saleId === saleId ? { ...i, ...patch } : i)))

  const answer = async (q: SaleQuestion, kind: 'confirm' | 'decline') => {
    // Both synchronously, in the tap's own handler (the prompt's prop contracts): the spinner up before
    // the next paint, and the old message gone so the next failure reads as a NEW report.
    update(q.saleId, { pending: kind, error: null })
    const failed = tr('Could not send your answer — please try again.', 'Chưa gửi được câu trả lời — vui lòng thử lại.')
    let res: Response
    let data: { error?: unknown; status?: unknown } = {}
    try {
      res = await fetch(`/api/listings/${encodeURIComponent(q.listingId)}/sale-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: kind, price: q.price }),
      })
      data = await res.json().catch(() => ({}))
    } catch {
      update(q.saleId, { pending: null, error: failed })
      return
    }
    const recorded = data.status === 'confirmed' || data.status === 'declined' ? data.status : null
    if (res.ok) {
      update(q.saleId, { pending: null, status: recorded ?? (kind === 'confirm' ? 'confirmed' : 'declined') })
      return
    }
    // Already answered (another device, a lost response): show what IS on record — never re-ask it.
    if (res.status === 409 && data.error === 'already_resolved' && recorded) {
      update(q.saleId, { pending: null, status: recorded })
      return
    }
    // The question is not the one shown any more (the seller changed the price) or has closed: say so,
    // re-arm the card, and fetch what is being asked now.
    if (res.status === 409 && data.error === 'not_actionable') {
      update(q.saleId, { pending: null, error: tr('This changed since you opened it — check it again.', 'Thông tin đã thay đổi từ lúc bạn mở — vui lòng kiểm tra lại.') })
      void load()
      return
    }
    // Not theirs to answer any more (re-attributed, relisted, taken down, gone): the card goes, and says why.
    if (res.status === 403 || res.status === 404 || (res.status === 409 && data.error === 'listing_unavailable')) {
      setItems((prev) => prev.filter((i) => i.q.saleId !== q.saleId))
      toast.error(tr('This question is no longer open.', 'Câu hỏi này không còn mở nữa.'))
      return
    }
    update(q.saleId, { pending: null, error: failed })
  }

  if (items.length === 0) return null
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {items.map((i) => (
        <SaleConfirmPrompt
          key={i.q.saleId}
          saleId={i.q.saleId}
          sellerName={sellerName}
          listingTitle={i.q.title}
          price={i.q.price}
          currency={i.q.currency}
          status={i.status}
          pending={i.pending}
          errorMessage={i.error}
          onConfirm={() => void answer(i.q, 'confirm')}
          onDecline={() => void answer(i.q, 'decline')}
        />
      ))}
    </div>
  )
}
