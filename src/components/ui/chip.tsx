'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

/**
 * THE INTERACTIVE CHIP (D-CHIP, 2026-09-29) — a rounded-full control that is either an ACTION (a quick
 * reply, an opener, "Keep it live") or a two-state FILTER (pressed / not). `<Badge>` stays for STATIC
 * status pills; this is for the ones you tap.
 *
 * ⚠️ WHY IT EXISTS: 24+ hand-rolled pill geometries (28/32/36px) across the app, and the same class
 * string restated in two files with a comment asking for "ONE copy in a shared module rather than
 * letting a second one drift" (opener-picker.tsx, quick-reply-chips.tsx). This is that module.
 *
 * ⚠️ TWO ELEMENTS, CHOSEN BY WHETHER `pressed` IS PASSED — never a boolean prop on one element:
 *   · `pressed` given   → ui/toggle (Base UI Toggle: a real `aria-pressed` button, `data-pressed`,
 *                         haptics). Style the pressed look off `data-pressed:`.
 *   · `pressed` omitted → ui/button, `variant="bare" size="none"`, so an action chip keeps the house
 *                         press (0.97 on the snappy spring), the focus outline and the cursor, exactly
 *                         as the hand-rolled chips it replaces already had through ui/button.
 * For a chip that NAVIGATES, put `chipVariants({ size, tone })` on the <Link> — a link is not a toggle.
 *
 * Geometry is `min-h-*` + `py-1.5`, never a fixed `h-*`: the OS text-size preference scales the line
 * box (see ui/button's size note), and a fixed height would clip a chip label at 150%.
 *   size xs  28px — dense horizontal scrollers above a composer (quick replies, openers)
 *        sm  32px · md 36px — filter rows and checklists (no call site yet; the facet and post-wizard
 *            chips move here when their owning packages next touch them)
 *   tone ghost   — transparent at rest, muted fill on hover (the composer chips)
 *        neutral — a tint pill; pressed = the accent capsule
 *        warning — the caution tint, for "still needed" style prompts
 */
export const chipVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold',
  {
    variants: {
      size: {
        xs: 'min-h-7 px-3 py-1.5 text-xs',
        sm: 'min-h-8 px-3 py-1.5 text-xs',
        md: 'min-h-9 px-3.5 py-1.5 text-sm',
      },
      tone: {
        ghost: 'text-body hover:bg-muted hover:text-foreground',
        neutral:
          'bg-tint text-body hover:bg-accent hover:text-accent-foreground data-pressed:bg-accent data-pressed:text-accent-foreground data-pressed:ring-1 data-pressed:ring-brand/30',
        warning: 'bg-warning/10 text-warning',
      },
    },
    defaultVariants: { size: 'sm', tone: 'neutral' },
  },
)

type ChipBase = VariantProps<typeof chipVariants> & { className?: string; children?: React.ReactNode }

/**
 * ⚠️ THE TOGGLE PATH NAMES ITS OWN MOTION, the action path inherits ui/button's. ui/toggle carries no
 * transition, so the pressed chip gets the same press contract as a Button (160ms back on the snappy
 * spring, 60ms down) — spelled out here rather than sent through Button, whose base would fight the
 * Toggle's own focus ring.
 */
const TOGGLE_MOTION =
  'transition-[color,background-color,box-shadow,scale] duration-[160ms] ease-spring-snappy active:scale-[0.97] active:duration-[60ms]'
/**
 * ⛔ AN UNPRESSED TOGGLE MUST NOT HOVER INTO THE PRESSED LOOK (preview check, 2026-10-07). The neutral tone hovers to
 * bg-accent / text-accent-foreground — the very tokens of `data-pressed`, so on a desktop a hovered free period read as
 * picked. Toggles in the neutral tone only: an action chip has no pressed state to be confused with, and the other tones
 * keep their own hover.
 */
const TOGGLE_HOVER = 'not-data-pressed:hover:bg-muted not-data-pressed:hover:text-foreground'

export function Chip(
  props:
    | (ChipBase & { pressed: boolean; onPressedChange: (pressed: boolean) => void } & Omit<React.ComponentProps<typeof Toggle>, 'pressed' | 'onPressedChange' | 'className' | 'children'>)
    | (ChipBase & { pressed?: undefined; onPressedChange?: undefined } & Omit<React.ComponentProps<typeof Button>, 'variant' | 'size' | 'className' | 'children' | 'asChild'>),
) {
  if (props.pressed !== undefined) {
    const { pressed, onPressedChange, size, tone, className, children, ...rest } = props
    return (
      <Toggle
        pressed={pressed}
        onPressedChange={onPressedChange}
        className={cn(chipVariants({ size, tone }), TOGGLE_MOTION, (tone ?? 'neutral') === 'neutral' && TOGGLE_HOVER, className)}
        {...rest}
      >
        {children}
      </Toggle>
    )
  }
  const { pressed: _pressed, onPressedChange: _onPressedChange, size, tone, className, children, ...rest } = props
  return (
    <Button type="button" variant="bare" size="none" className={cn(chipVariants({ size, tone }), className)} {...rest}>
      {children}
    </Button>
  )
}
