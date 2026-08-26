'use client'

import { useState } from 'react'
import { Headphones, Mail } from '@/components/ui/icons'
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <Button
          variant="bare"
          size="none"
          type="button"
          aria-label={tr('Contact support', 'Liên hệ hỗ trợ')}
          className={cn(
            /* An elevated disc, not a bare glyph. The chevron above it is bare because it is chrome
             the reader already understands; a support affordance has to read as a THING to press,
             and the surface is what says so. Quiet by default (ink on the page's own surface, one
             hairline, the shared pop shadow) rather than a brand-blue bubble — that treatment is
             reserved for the one CTA per screen, and a permanent blue disc on every page would
             outrank whatever the page is actually asking for. */
            'flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-background text-body shadow-pop',
            'transition-colors duration-200 hover:text-accent-foreground active:scale-[0.96] tap-44',
            className,
          )}
        />
      }>
        <Headphones className="h-5 w-5" strokeWidth={STROKE_FLOAT} aria-hidden />
      </SheetTrigger>

      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Headphones className="h-5 w-5 text-brand" aria-hidden />
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
