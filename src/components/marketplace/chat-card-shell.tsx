'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ONE shell for every card that appears inside a chat thread.
//
// Owner, 2026-07-26: *"match in chat visa ui interface to itinerary ui interface, one wider one
// whiter etc, make them follow app design language and have similar feel."* The divergence was
// measurable, not a matter of taste: the visa shell was `w-[92%] max-w-md` (28rem) on `bg-card`
// with `shadow-pop` and a brand hairline, while every trip card was `w-full max-w-[22rem]` (22rem)
// with no shadow — 6rem narrower, and reading flatter and duller beside it. The visa family alone
// had a branded eyebrow, a step badge, a progress rail and a live/settled tone system.
//
// ⚠️ THE POINT IS THAT NEITHER FAMILY OWNS THESE CLASS STRINGS ANY MORE. They drifted because both
// files spelled out their own geometry, so a change to one was invisible to the other. Anything
// that should look the same on both belongs in this file; a card that needs to differ passes a
// prop. Copying a class list back out is how this returns.
//
// ⚠️ FLAT, per docs/design-language.md §3b. `--card` is deliberately identical to `--background`,
// and elevation is reserved for things that genuinely float above the page — dialogs, popovers,
// toasts. A chat card sits in normal flow, so the visa shell's `shadow-pop` went: it was the
// literal "raised" half of the owner's complaint, and the live/settled distinction does not need
// it (see below).
//
// ⚠️ THREE OF THE CLASSES THIS REPLACES DID NOT EXIST. `bg-surface-1`, `border-line` and
// `text-ink-1` are not tokens in globals.css, so Tailwind emitted no rule for any of them —
// confirmed by searching the built CSS, not by reading the theme. Every trip card was therefore
// rendering with NO fill and NO border colour (falling back to `currentColor`, i.e. a heavy dark
// hairline) since it was written. That, more than any spacing choice, is what made the two
// families look unrelated. Use tokens that exist; a dead utility fails silently and forever.

export type ChatCardTone = 'live' | 'settled'

/**
 * Live vs settled, carried by the hairline and the eyebrow/title colour.
 *
 * ⚠️ `bg-card/70` IS VISUALLY A NO-OP HERE and is kept only for a card that one day sits on a
 * tinted surface. `--card` is identical to `--background`, so 70% of the canvas colour over the
 * canvas composites back to the canvas — the fill contributes NOTHING to the distinction, and an
 * earlier version of this comment claimed it did. (codex.) With the shadow gone, what is left is
 * colour, which also means the two tones collapse under `forced-colors`.
 *
 * That is acceptable because the tone is REINFORCEMENT, not the message. A settled visa card says
 * "✓ Done" in its own body, and a settled quote says its status in a badge — the fact that a step
 * is behind you is always in the card's TEXT. If that ever stops being true, this needs a
 * non-colour cue, not a darker border.
 */
const TONE: Record<ChatCardTone, { frame: string; accent: string; title: string }> = {
  live: { frame: 'border-brand/30 bg-card', accent: 'text-accent-foreground', title: 'text-foreground' },
  settled: { frame: 'border-border bg-card/70', accent: 'text-ink-4', title: 'text-body' },
}

export function ChatCard({
  eyebrow, icon: Icon, title, step, right, tone = 'live', className, children,
}: {
  /** The family label — "e-Visa", "Trip". Small, uppercase, and the one constant across cards. */
  eyebrow: string
  icon: LucideIcon
  title?: string
  /** Renders the standard "Step 2 of 5" badge. Ignored when `right` is supplied. */
  step?: { current: number; total: number } | null
  /**
   * Anything else for the top-right slot — a status badge, say. Replaces `step`.
   *
   * ⚠️ THE SHELL POSITIONS THIS, callers must not. It used to be dropped into the header raw, so
   * `right={<Badge/>}` type-checked and rendered flush against the eyebrow instead of at the right
   * edge, and only the one existing caller's hand-written `ml-auto` made it look right. (codex.)
   */
  right?: ReactNode
  tone?: ChatCardTone
  className?: string
  children?: ReactNode
}) {
  const { tr } = useLanguage()
  const t = TONE[tone]
  return (
    <div
      className={cn(
        // `allow-select`: the thread suppresses text selection, and a card is content people
        // legitimately want to copy — an amount, a reference, a place name.
        'allow-select w-[92%] max-w-md rounded-2xl border px-3.5 py-3',
        t.frame,
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', t.accent)} aria-hidden />
        <span className={cn('text-2xs font-bold uppercase tracking-wide', t.accent)}>{eyebrow}</span>
        {/* ⚠️ `!== undefined`, not `??`. With `??`, a caller passing a falsy-but-defined value —
            `right={someFlag && <Badge/>}` is the obvious way to write a conditional badge — got
            `false`, which suppressed the step badge silently instead of falling back to it. */}
        {right !== undefined ? (
          <span className="ml-auto shrink-0">{right}</span>
        ) : step ? (
          <Badge variant="neutral" size="sm" className="ml-auto shrink-0">
            {tr(`Step ${step.current} of ${step.total}`, `Bước ${step.current}/${step.total}`)}
          </Badge>
        ) : null}
      </div>
      {title ? <h3 className={cn('mt-1.5 text-sm font-bold', t.title)}>{title}</h3> : null}
      {children}
    </div>
  )
}

/**
 * The progress rail — "not more than 5 pages", made visible.
 *
 * Lived in visa-cards.tsx, where it was the clearest signal that a card was part of a sequence.
 * The trip wizard is also five steps and had only a "Step 3/5" caption, so it now reads the same.
 *
 * ⚠️ DECORATIVE, deliberately. It carried `role="img"` with an aria-label of "Step 2 of 5" — the
 * exact string the badge two lines above it already announces, so a screen reader heard the step
 * twice on every card. (codex.) Both call sites pair the rail with that badge, which is the
 * accessible statement; the rail is the picture of it. A future card that wants the rail WITHOUT a
 * badge has to label it.
 */
export function ChatCardSteps({ current, total }: { current: number; total: number }) {
  return (
    <div className="mt-2 flex items-center gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          className={cn('h-1 flex-1 rounded-full', n < current ? 'bg-brand/40' : n === current ? 'bg-brand' : 'bg-tint')}
          aria-hidden
        />
      ))}
    </div>
  )
}
