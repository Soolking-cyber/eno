'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { logError } from '@/lib/log'
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
  const { user } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(false)

  /**
   * Signed in → a real conversation in /messages. Owner: *"auto open message ... route to message
   * tab and open message with support"*.
   *
   * ⚠️ THE ROUTE TAKES NO BODY. Buyer, seller and edition are all resolved server-side, so there is
   * nothing here that could open somebody else's thread or reach the other edition's desk.
   * ⚠️ ON FAILURE IT FALLS BACK TO THE PANEL RATHER THAN TO AN ERROR. A person tapping "support" is
   * already having a problem; the email form still reaches the same inbox, so a 500 costs them a
   * different form, not their route to help.
   */
  const openThread = async () => {
    if (opening) return
    setOpening(true)
    try {
      const res = await fetch('/api/support/thread', { method: 'POST' })
      if (!res.ok) throw new Error(`support-thread ${res.status}`)
      const { id } = (await res.json()) as { id: string }
      router.push(`/messages/${id}`)
    } catch (e) {
      logError(e, { op: 'support.openThread' })
      setOpen(true)
    } finally {
      setOpening(false)
    }
  }
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
    /**
     * ⛔ THE SIGNED-IN BRANCH LIVES IN onOpenChange, NOT IN THE TRIGGER'S onClick, and that is not a
     * style choice. The trigger has to stay a real `SheetTrigger` — Base UI restores focus to the
     * trigger IT registered, and a hand-rolled open flag registers nothing (measured: opening left
     * `document.activeElement` on <body>, and Escape left it there too). But a signed-in tap must
     * NOT open the sheet. Intercepting here uses the controlled contract that already exists: the
     * trigger asks to open, and this decides what "open" means. Trying to cancel the trigger's own
     * click with preventDefault would be a guess about Base UI's internals.
     * ⚠️ Only `next === true` is intercepted, so Escape and backdrop clicks still close normally.
     */
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next && user) { void openThread(); return }
        setOpen(next)
      }}
    >
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
          data-busy={opening || undefined}
          inert={scrolledAway || undefined}
          aria-hidden={scrolledAway || undefined}
          tabIndex={scrolledAway ? -1 : undefined}
          className={cn(
            /* ⛔ NO PLATE. Owner, 2026-08-26: *"no outline plate for this support icon"* — this
               control carried a white `rounded-xl` plate (border + bg-popover + shadow-pop) for
               about an hour and it is gone. Do not reintroduce it as a legibility fix; the fix is
               the drop-shadow on the glyph, below.
               ⚠️ BARE IS ALSO WHAT MAKES THE CLUSTER ONE THING. The back-to-top chevron directly
               above is a bare glyph with a drop-shadow, and a plated neighbour read as two
               unrelated controls stacked by accident rather than as one column of page chrome.
               The mark now takes the chevron's exact treatment.

               ⚠️ THE 46px GLYPH SIZE IS KEPT FROM THE PLATED VERSION ON PURPOSE. It was derived to
               sit 1px inside a 44px plate, and with the plate gone that derivation no longer means
               anything — but the SIZE was the thing the owner converged on across four rounds
               ("larger", "as big as its background", "leave 1 pixel"), so it stays. The box is
               46px inside an `h-11` (44px) hit box and paints ~42px of ink; `shrink-0` stops the
               flex parent reclaiming the 2px of overflow, which carries no paint.
               ⛔ THAT NUMBER IS PER-GLYPH AND DOES NOT TRANSFER. dialog-2 needs 46 where
               question-square needed 50 for the same gap. Swapping the icon means re-measuring on
               the rendered page — the sprite's own bbox is not a shortcut, it predicted 42px of
               ink at box 47 where the page drew 40.

               ⚠️ `text-muted-foreground` IS THE DUOTONE'S FRONT SHAPE — owner: *"front one our
               gray"*. The front ships `fill="currentColor"`, so the control's own text colour
               paints it; the BACK shape reads `--i-back-color` (brand blue) at `--i-back-opacity`
               (0.5), both set by `.support-mark` in globals.css. Two colours, one glyph, no
               per-shape markup here — and it has to be custom properties rather than a class,
               because the glyph is a `<use>` and lives in a shadow tree a selector cannot reach.
               ⛔ `support-mark` IS LOAD-BEARING, NOT DECORATIVE: it carries both those custom
               properties and the press-to-bold rule. Removing it silently returns a grey mark
               with no back shape and no press state. */
            'support-mark flex h-11 w-11 items-center justify-center text-muted-foreground',
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
        {/* ⚠️ THE SAME DROP-SHADOW LITERAL AS THE CHEVRON ABOVE (back-to-top.tsx), copied rather than
            tokenised: these two are the only bare glyphs floating over arbitrary page content, and
            the value is the pair's shared definition of "readable on a near-white ground". If it
            ever moves, it moves in both.
            ⚠️ NOT `icon-shadow-brand` — that is a BRAND-BLUE shadow, which under a grey front shape
            reads as a colour fringe rather than as lift. */}
        <SupportDialog
          className="h-[46px] w-[46px] shrink-0 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]"
          strokeWidth={STROKE_FLOAT}
          aria-hidden
        />
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
            {/* ⚠️ THIS PANEL IS NOW THE SIGNED-OUT PATH, so it says what the signed-in one gets.
                A signed-in tap never reaches here — it opens a real thread — so anyone reading this
                is signed out, and the honest thing is to offer the better route rather than let
                them assume email is all there is. */}
            {!user && (
              <p className="pt-1 text-xs text-muted-foreground">
                <Link href="/signin" className="font-semibold text-accent-foreground underline-offset-2 hover:underline">
                  {tr('Sign in', 'Đăng nhập')}
                </Link>{' '}
                {tr('to chat with support instead.', 'để trò chuyện trực tiếp với hỗ trợ.')}
              </p>
            )}
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
