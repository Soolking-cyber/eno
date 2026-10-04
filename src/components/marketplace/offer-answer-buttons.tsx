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
 *
 * ⚠️ ONE ROW WHERE IT FITS, A WRAP — NEVER AN OVERFLOW — WHERE IT DOES NOT (si-09, 2026-10-04). The row
 * wrapped Counter onto a second line on every phone, so an incoming offer card was three lines of buttons
 * tall. What fixed it is the PADDING (px-4 → px-1): measured with Open Runde's own advance widths at
 * text-sm bold, 73.8 + 51.9 + 47.2 = 173px of label, + 3×8px padding + 2×12px gaps = 221px, inside the
 * card's 236px content box at a 360px viewport (80% of the 328px row, minus the card's padding and
 * border). `grow` shares the spare width out by label, so the long "Chấp nhận" keeps more room than
 * "Trả giá". `flex-wrap` stays as the fallback: below ~340px (a 320px phone) the three no longer fit,
 * and Counter drops to its own line instead of pushing out of the card — a single-row grid had no such
 * escape. The 12px gap is the owner's floor above, on both axes.
 *
 * `canAccept` (default true) is off on a thread CLOSED by a block (App Store gate `ugc-safety`): the server
 * refuses the accept, so the button would be a guaranteed error. Decline always stays — a pending card must
 * always be clearable.
 */
export function OfferAnswerButtons({ onAccept, onDecline, onCounter, canCounter, canAccept = true }: {
  canAccept?: boolean
  onAccept: () => void
  onDecline: () => void
  onCounter: () => void
  canCounter: boolean
}) {
  const { tr } = useLanguage()
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {canAccept && <Button variant="cta" size="none" onClick={onAccept} className="min-h-11 grow rounded-xl px-1 text-sm cursor-pointer">{tr('Accept', 'Chấp nhận')}</Button>}
      {/* hover:text-body is LOAD-BEARING: ghost injects hover:text-accent-foreground,
          and text-body is a COLOUR — without the re-assert the label flips colour on hover. */}
      <Button variant="ghost" size="none" onClick={onDecline} className="min-h-11 grow rounded-xl px-1 text-sm font-bold text-body hover:bg-muted hover:text-body cursor-pointer">{tr('Decline', 'Từ chối')}</Button>
      {canCounter && (
        <Button variant="ghost" size="none" onClick={onCounter} className="min-h-11 grow rounded-xl px-1 text-sm font-bold text-accent-foreground hover:bg-muted cursor-pointer">{tr('Counter', 'Trả giá')}</Button>
      )}
    </div>
  )
}
