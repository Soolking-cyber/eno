'use client'

import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'

/**
 * ACCEPT · DECLINE · COUNTER — the answer row on an incoming offer card in a chat thread.
 *
 * Out of messages/[id]/page.tsx so its geometry can be pinned by a test; the page still owns every
 * decision (what a tap does, and whether Counter may exist at all).
 *
 * ⛔ 44px DRAWN, 12px APART — owner, 2026-09-25: "add clear spacing between the two buttons (≥12px,
 * 44px targets)". These act on money, and they sat 24px tall and 6px apart (later 8px, with a `tap-44`
 * pseudo growing each one to 44px). The pseudo is gone on purpose: a visible 24px button with an
 * invisible 44px reach is a target the eye cannot aim at, and the reaches were what forced the old
 * `gap-y-5` — on a wrapped row they met edge to edge, so a tap on the bottom of Accept could land on the
 * button below (22 points measured). Drawn at `min-h-11`, what the finger sees is what it hits, and one
 * `gap-3` gives 12px between targets on BOTH axes, including the 320px wrap where Counter drops to a
 * second row. globals.css says it plainly: prefer not needing tap-44.
 *
 * ⛔ COUNTER IS GATED BY THE CALLER, AND `canCounter` IS REQUIRED. Countering SENDS an offer; on a
 * fixed-price listing the send route answers 409 not_negotiable AND docks the buyer's trust. The page
 * passes `!!thread?.listing && thread.listing.negotiable !== false` — see the note there on why the
 * listing check comes first.
 */
export function OfferAnswerButtons({ onAccept, onDecline, onCounter, canCounter }: {
  onAccept: () => void
  onDecline: () => void
  onCounter: () => void
  canCounter: boolean
}) {
  const { tr } = useLanguage()
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      <Button variant="cta" size="none" onClick={onAccept} className="min-h-11 rounded-xl px-4 text-sm cursor-pointer">{tr('Accept', 'Chấp nhận')}</Button>
      {/* hover:text-body is LOAD-BEARING: ghost injects hover:text-accent-foreground,
          and text-body is a COLOUR — without the re-assert the label flips colour on hover. */}
      <Button variant="ghost" size="none" onClick={onDecline} className="min-h-11 rounded-xl px-4 text-sm font-bold text-body hover:bg-muted hover:text-body cursor-pointer">{tr('Decline', 'Từ chối')}</Button>
      {canCounter && (
        <Button variant="ghost" size="none" onClick={onCounter} className="min-h-11 rounded-xl px-4 text-sm font-bold text-accent-foreground hover:bg-muted cursor-pointer">{tr('Counter', 'Trả giá')}</Button>
      )}
    </div>
  )
}
