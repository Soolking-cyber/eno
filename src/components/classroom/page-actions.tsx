'use client'

import { Button } from '@/components/ui/button'
import { StickyActionBar, StickyActionBarSpacer, type StickyActionBarAction } from '@/components/ui/sticky-action-bar'
import { cn } from '@/lib/utils'

/**
 * A CLASSROOM PAGE'S ONE PRIMARY ACTION, WHERE THE THUMB IS (owner, 2026-10-26: mobile first). On a phone or a tablet it
 * is pinned to the bottom edge — ui/sticky-action-bar, which already solves the safe area, the keyboard and the room it
 * takes (its spacer) — and it stays in the same place from one step to the next. From `lg` the page is a centred phone
 * column on a wide window, where a full-width bar reads heavy, so the same actions render inline instead: exactly the
 * split ui/step-wizard makes for the avatar wizard, so the two flows behave alike. Copy-free, like the primitives.
 *
 *   <PageActions primary={{ label, onClick }} />       the bar (phone) + the inline row (lg), together, at the END
 *   <PageActionBar … /> + <PageActionsInline … />       split: the inline row where it reads best on a wide window (a
 *                                                      landing's hero), the bar + its spacer at the page's end
 *
 * ⛔ ONE BAR PER PAGE, AND ITS SPACER IS THE LAST THING IN THE PAGE'S FLOW (ui/sticky-action-bar's two ⚠️⚠️): render it
 * at the end of the page, under the same condition that decides the action exists.
 * ⛔ KEEP IT AT ONE PLACE IN THE TREE ACROSS STEPS: a remount replays the bar's arrival (it rises from below the edge).
 */

/** A bar action without `render`: every classroom action is a button, and the inline twin below draws only buttons. */
export type PageAction = Omit<StickyActionBarAction, 'render'>

/** The phone/tablet half: the pinned bar and the room it takes. `note` rides above the buttons (StickyActionBar `above`). */
export function PageActionBar({ primary, secondary, note }: { primary: PageAction; secondary?: PageAction; note?: React.ReactNode }) {
  return (
    <>
      <StickyActionBar primary={primary} secondary={secondary} above={note} className="lg:hidden" />
      <StickyActionBarSpacer className="lg:hidden" />
    </>
  )
}

/** The wide-window half: the same actions in the flow, the primary filling the column (hidden below `lg`). */
export function PageActionsInline({ primary, secondary, note, className }: {
  primary: PageAction
  secondary?: PageAction
  note?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('hidden flex-col gap-3 lg:flex', className)}>
      {note}
      <div className="flex items-center gap-3">
        {secondary && <InlineAction action={secondary} variant="outline" />}
        <InlineAction action={primary} variant="cta" />
      </div>
    </div>
  )
}

/**
 * Both halves at the end of the page. ⚠️ `note`: PASS `null`, NOT `undefined`, WHILE IT IS EMPTY BUT MAY FILL (an error
 * after a tap) — StickyActionBar's rule: flipping between its two shapes remounts the primary button and drops focus.
 */
export function PageActions({ primary, secondary, note }: { primary: PageAction; secondary?: PageAction; note?: React.ReactNode }) {
  return (
    <>
      <PageActionsInline primary={primary} secondary={secondary} note={note} className="mt-6" />
      <PageActionBar primary={primary} secondary={secondary} note={note} />
    </>
  )
}

/** The inline twin of a bar action: ui/button at the bar's 48px, the primary taking the rest of the row. */
function InlineAction({ action, variant }: { action: PageAction; variant: 'cta' | 'outline' }) {
  const { label, icon, onClick, disabled, loading, ariaLabel, type = 'button' } = action
  return (
    <Button
      variant={variant}
      size="lg"
      type={type}
      disabled={disabled}
      loading={loading}
      aria-label={ariaLabel}
      onClick={onClick}
      // min-w-0 + whitespace-normal: a long Vietnamese label wraps instead of pushing the row past the column (the
      // sticky bar's own measured reason).
      className={cn('min-h-12 min-w-0 gap-1.5 whitespace-normal', variant === 'cta' && 'flex-1')}
    >
      {icon}
      {label}
    </Button>
  )
}
