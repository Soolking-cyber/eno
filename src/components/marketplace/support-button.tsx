'use client'

import { useState } from 'react'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { MessageSquareQuestion, Mail } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { HelpFeedback } from '@/components/marketplace/help-feedback'
import { useLanguage } from '@/context/language-context'
import { COMPANY } from '@/lib/site-legal'
import { STROKE_FLOAT } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'

/**
 * The floating "talk to us" control, and the panel it opens.
 *
 * ⛔ THE TRIGGER LIVES IN THE back-to-top CLUSTER, NOT IN ITS OWN FIXED BOX. That cluster already
 * solves every hard part of being a floating control here, and each one was a bug first: it clears
 * the mobile bottom-nav with the `max(env, var)` pairing Android WebView needs, it disappears under
 * any dialog/sheet/alert (at z-[60] it used to sit ON TOP of the report dialog's submit button), and
 * it stands down entirely on /messages, which owns the bottom-right corner with its composer. A
 * second fixed element would have to re-derive all of that and would drift from it. Being a sibling
 * in the same flex column is also what makes "must not overlap the back-to-top arrow" true by
 * construction rather than by a magic offset.
 *
 * ⛔ THE TRIGGER IS `SheetTrigger`, NOT A useState BUTTON — AND I WROTE IT THE WRONG WAY FIRST,
 * with a comment claiming the Sheet lived outside the cluster when the Root is plainly a child of
 * it (only the POPUP is portaled). The consequence was not theoretical: measured at 1280px, opening
 * the panel left `document.activeElement` on <body>, and closing with Escape left it there too — so
 * a keyboard user got a dialog they were not moved into and, on closing, no way back to where they
 * were. Base UI restores focus to the trigger IT registered; a hand-rolled open flag registers
 * nothing. `render` rather than `asChild` per the house rule for Base UI.
 * ⚠️ The cluster being CSS-hidden while the sheet is open is fine for this: `body:has(...)` stops
 * matching the instant the popup unmounts, so the trigger is visible again before focus returns to
 * it. Hidden is not unmounted.
 */
export function SupportButton({ className }: { className?: string }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  /**
   * ⚠️ THE SAME SIGNAL THE BOTTOM NAV USES, so the two move as one piece of chrome rather than as
   * two things that happen to animate. mobile-nav.tsx calls this hook and applies
   * `translate-y-full opacity-0 pointer-events-none`; this mirrors it, and mirrors its transition,
   * so the support mark rides down with the bar and comes back on the same scroll-up.
   * ⚠️ MOBILE ONLY (`max-lg:`). There is no bottom nav from lg up — nothing to move with — and
   * hiding a support affordance on a desktop scroll would just make it hard to find.
   */
  const scrolledAway = useHideOnScroll()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <Button
          variant="bare"
          size="none"
          type="button"
          aria-label={tr('Contact support', 'Liên hệ hỗ trợ')}
          /* ⛔ data-active IS HOW THE BOLD WEIGHT AND THE BRAND BLUE ARE TURNED ON, and it is the
             house switch rather than a one-off: globals.css shows the `.i-on` (filled) sprite layer
             for a control carrying aria-pressed/aria-selected/aria-expanded/data-active, and paints
             that layer `--color-accent-foreground` — the brand blue, already themed for dark mode.
             So "bold, in our blue" needs no colour class here and cannot drift from the rest of the
             icon system.
             ⚠️ `data-active`, NOT `aria-pressed="true"`. The ARIA options all assert something to a
             screen reader — that this is a toggle currently pressed, or a selected option — and none
             of that is true of a support button. data-* asserts nothing. */
          data-active="true"
          /* ⛔ HIDDEN FROM THE MOUSE IS NOT HIDDEN. opacity-0 + translate + pointer-events-none
             leave this in the TAB ORDER and in the accessibility tree, so a keyboard user scrolling
             down would tab into an off-screen support button — the identical trap the chevron above
             documents and solves with `inert`. Same three levers here: inert removes focus, pointer
             and a11y in one; aria-hidden + tabIndex=-1 are the fallback for browsers without it. */
          inert={scrolledAway || undefined}
          aria-hidden={scrolledAway || undefined}
          tabIndex={scrolledAway ? -1 : undefined}
          className={cn(
            /* An elevated disc, not a bare glyph. The chevron above it is bare because it is chrome
             the reader already understands; a support affordance has to read as a THING to press,
             and the surface is what says so. Quiet by default (ink on the page's own surface, one
             hairline, the shared pop shadow) rather than a brand-blue bubble — that treatment is
             reserved for the one CTA per screen, and a permanent blue disc on every page would
             outrank whatever the page is actually asking for. */
            /* ⛔ A BARE GLYPH, NO DISC — matching the chevron above it. Solar's question-circle
               already DRAWS a circle, so wrapping it in a bordered disc was a circle inside a
               circle. The drop-shadow is the only backing, exactly as the chevron does it: that is
               what lets a bare mark survive over card photography without a plate behind it.
               ⚠️ BRAND BLUE, NOT WHITE AND NOT BODY INK. White was asked for and would be invisible
               on this app's light surfaces — footer, page ground and most cards are near-white, and
               a drop-shadow alone cannot carry a white mark. The blue arrives from `data-active`
               below (the icon system paints the bold layer `--color-accent-foreground`), so
               `text-body` on this element is only the fallback the SVG inherits before the bold
               layer paints, and what the hover state returns to.
               ⚠️ h-11 w-11 + tap-44 is the CHEVRON'S box, kept so the two align in the column; the
               glyph inside is larger than the chevron's (h-8 vs h-7) because this one is an
               invitation rather than chrome. */
            'flex h-11 w-11 items-center justify-center rounded-full text-body',
            'transition-colors duration-200 hover:text-accent-foreground active:scale-[0.96] tap-44',
            /* Ride down with the bottom nav, same motion the bar itself uses.
               ⚠️ `translate`, NOT `transform`, in the property list — Tailwind v4 compiles
               `translate-*` to the standalone `translate` property, so naming `transform` here
               subscribes to something nothing writes and the move happens in a single frame.
               design-lint caught exactly that; the rule exists because it fails invisibly. */
            'max-lg:transition-[translate,opacity] max-lg:duration-300 max-lg:ease-[var(--ease-spring)] motion-reduce:transition-none',
            scrolledAway && 'max-lg:pointer-events-none max-lg:translate-y-[calc(100%+1.25rem)] max-lg:opacity-0',
            className,
          )}
        />
      }>
        <MessageSquareQuestion className="h-8 w-8 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]" strokeWidth={STROKE_FLOAT} aria-hidden />
      </SheetTrigger>

      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <MessageSquareQuestion className="h-5 w-5 text-brand" aria-hidden />
              {tr('Support', 'Hỗ trợ')}
            </SheetTitle>
            {/* ⚠️ COMPANY.email, NEVER A LITERAL. It is already per-edition — support@eno.vn on the
                marketplace, support@eno.forum on the services build — and hardcoding either would
                put one site's inbox on the other, which is the same class of error as the copyright
                line that once said "© eno.vn" on eno.forum. */}
            <SheetDescription>
              {tr('Tell us what is going on and we will reply by email.', 'Cho chúng tôi biết vấn đề, chúng tôi sẽ trả lời qua email.')}
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pb-6">
            <HelpFeedback />

            {/* The escape hatch for anyone who would rather use their own mail client — and the
                honest disclosure of WHERE the form above lands, which the form itself does not say. */}
            <p className="mt-6 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              {tr('Prefer email?', 'Thích dùng email hơn?')}{' '}
              <a
                href={`mailto:${COMPANY.email}`}
                className="inline-flex items-center gap-1 font-semibold text-accent-foreground underline-offset-2 hover:underline"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden />
                {COMPANY.email}
              </a>
            </p>
          </div>
        </SheetContent>
    </Sheet>
  )
}
