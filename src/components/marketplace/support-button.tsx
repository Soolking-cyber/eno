'use client'

import { useState } from 'react'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { SupportDialog, Mail } from '@/components/ui/icons'
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
          /* ⛔ THE PERMANENT `data-active="true"` THAT USED TO BE HERE IS GONE, and its removal is
             the whole point of the duotone. It forced the app-wide SELECTED weight on a control
             that is never selected — the icon grammar's one job is that bold means "you are on
             this". The mark now carries its own colour at rest (duotone: grey front, brand-blue
             back at 50%) and goes bold only while a finger is down, via `.support-mark` in
             globals.css. Owner, 2026-08-26: *"bold on press"*. */
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
            /* A WHITE PLATE IN THE GLYPH'S OWN SHAPE — `rounded-xl` (12px), the canon's control
               tier, so the plate echoes question-square's rounded square rather than boxing a
               square inside a circle. Border + shadow-pop are what make it read as a surface
               floating over the page instead of a sticker.
               ⚠️ `bg-popover`, NOT a literal white and not `bg-background`. This app HAS no pure
               white — every light surface token is #fafafa on purpose — so #fafafa is its white,
               and a hard-coded #fff plate would be the only element on the page that is not.
               `popover` over `background` because it is the token for a surface FLOATING above the
               page: identical in light (both #fafafa, so the border and shadow do the separating)
               and LIFTED in dark (#2a2a2a against the #1b1b1b canvas), which is exactly the
               difference a floating plate needs and `background` would not give it.
               ⚠️ THE GLYPH BOX IS 46px INSIDE A 44px PLATE, WHICH IS NOT A TYPO. The visible mark
               is smaller than its own box — the sprite leaves built-in margin — so sizing the box to
               the plate paints a mark with a fat gap around it. Owner asked for one pixel; one pixel
               of INK, not of box. Swept on the built page, ink read off the rendered pixels:
                 box 44 → ink 40.5, gap 2      box 50 → ink 46, gap −1 (spills past the plate)
                 box 46 → ink 42,   gap 1  ←   box 52 → ink 48, gap −2
                 box 48 → ink 44,   gap 0 (flush with the border)
               ⚠️ EVEN, because an odd box in an even plate splits the overflow across a half-pixel
               and the mark lands visibly off-centre — 47px measured 2.5 left and 1.5 right.
               `shrink-0` stops the flex parent reclaiming the 1px of overflow.
               ⛔ THIS NUMBER IS PER-GLYPH AND DOES NOT TRANSFER. The previous mark (question-square)
               needed box 50 for the same 1px; dialog-2 needs 46, because the two drawings fill their
               24-unit grid differently. Swapping the icon means re-running the sweep — and the
               sprite's own bbox is NOT a shortcut: it predicted 42 at box 47 and measured 40.
               ⚠️ `text-muted-foreground` IS THE DUOTONE'S FRONT SHAPE — owner, 2026-08-26:
               *"front one our gray"*. The front ships `fill="currentColor"`, so the control's own
               text colour paints it; the BACK shape overrides that to brand blue at 50% via
               `.i-back` in globals.css. Two colours, one glyph, no per-shape markup at the call
               site. The plate is what makes the pair legible (this app's grounds are near-white),
               and with a plate behind it the glyph's own drop-shadow is removed — shadow over
               shadow reads muddy. */
            'support-mark flex h-11 w-11 items-center justify-center rounded-xl border border-border/70 bg-popover text-muted-foreground shadow-pop',
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
        <SupportDialog className="h-[46px] w-[46px] shrink-0" strokeWidth={STROKE_FLOAT} aria-hidden />
      </SheetTrigger>

      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <SupportDialog className="h-5 w-5 text-brand" aria-hidden />
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
