'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { getConsent, setConsent, syncConsentCookie } from '@/lib/consent'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'

function Toggle({ title, desc, value, onChange, locked = false }: { title: string; desc: string; value: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  return (
    <Button
      variant="bare"
      size="none"
      type="button"
      disabled={locked}
      onClick={() => onChange?.(!value)}
      className={cn('flex w-full items-start gap-2.5 whitespace-normal rounded-lg p-1.5 text-left transition-colors font-normal disabled:opacity-70', locked ? 'opacity-70' : 'hover:bg-muted cursor-pointer')}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-2xs leading-snug text-ink-4">{desc}</span>
      </span>
      <span className={cn('mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors', value ? 'bg-primary' : 'bg-line-strong')}>
        <span className={cn('h-4 w-4 rounded-full bg-white shadow-sm transition-transform', value && 'translate-x-4')} />
      </span>
    </Button>
  )
}

/**
 * How long the home page gets to itself before the first-visit consent card appears.
 *
 * Owner asked for "3-5 seconds"; 4s is the middle of that and is deliberately a named constant
 * rather than an inline literal, because the value is a product decision (how long the page reads
 * as uninterrupted) and not a timing detail. ⚠️ It applies ONLY to the automatic first-visit
 * prompt — the footer's "Cookie settings" re-open is a direct response to a click and must stay
 * instant, or the withdrawal path feels broken.
 */
const SHOW_AFTER_MS = 4_000

/** Sleek, compact consent banner — a horizontal card with the shield mascot filling
 *  the height on the left and tight copy + slim actions on the right. "Allow" turns on
 *  personalized recommendations + ad signals; "Settings" fine-tunes each or declines. */
export function CookieConsent() {
  const { tr } = useLanguage()
  // Where initial focus goes when the dialog opens — see initialFocus on the Popup below.
  const popupRef = useRef<HTMLDivElement>(null)
  /**
   * The pending first-visit timer, so `close()` can CANCEL it.
   *
   * ⚠️ THE GUARD INSIDE THE CALLBACK IS NOT ENOUGH ON ITS OWN, and review had to point that out
   * twice before this was right. Re-reading `getConsent()` covers "the user DECIDED during the
   * delay". It does not cover "the user LOOKED AND LEFT" — opening the footer's Cookie settings at
   * t=2s, reading it, and closing with Esc without choosing. Consent is still null, so the timer
   * fired and the card reappeared unbidden seconds after they dismissed it. Cancelling on close
   * covers both, and is the behaviour a person would describe as "I closed it".
   */
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [show, setShow] = useState(false)
  /**
   * Did the CARD open because the user asked for it (footer "Cookie settings"), or did it appear on
   * its own after the delay? Only the first may move focus — see `initialFocus` on the Popup.
   */
  const [openedByUser, setOpenedByUser] = useState(false)
  const [view, setView] = useState<'ask' | 'settings'>('ask')
  const [perso, setPerso] = useState(true)
  const [ads, setAds] = useState(true)

  /**
   * ⚠️ THE FIRST-VISIT PROMPT IS DELAYED; THE FOOTER RE-OPEN BELOW IS NOT.
   *
   * The page gets `SHOW_AFTER_MS` to itself before the card appears. Two reasons, and the second is
   * the one that costs money if it regresses:
   *   · A consent card that paints in the same frame as the hero reads as an interstitial. Letting
   *     the home page land first makes it an interruption of a page the visitor is already looking
   *     at, which is also the shape PDPL guidance describes.
   *   · Google's OAuth brand reviewer is ALWAYS a first visit, so whatever auto-opens is what they
   *     screenshot. Three verification rejections came out of that (see the note on the wrapper
   *     below); a few seconds of unobstructed home page is free insurance on the next review.
   *
   * Cleared on unmount so a fast navigate-away cannot fire setState on a dead component.
   */
  useEffect(() => {
    syncConsentCookie()
    if (getConsent() !== null) return
    const t = setTimeout(() => {
      autoTimer.current = null
      /**
       * ⚠️ RE-READ THE CHOICE INSIDE THE CALLBACK — the delay opened a window that did not exist
       * before, and review caught it. Four seconds is plenty of time for the visitor to open the
       * footer's "Cookie settings" themselves, decide, and close; the timer would then fire and
       * re-open the card on top of a decision they just made. The same applies to a choice stored
       * in ANOTHER TAB during the delay. The immediate version could not hit either case, because
       * it read and showed in the same tick.
       */
      if (getConsent() === null) setShow(true)
    }, SHOW_AFTER_MS)
    autoTimer.current = t
    return () => clearTimeout(t)
  }, [])

  // Withdrawal right (PDPL): the footer "Cookie settings" link dispatches this to
  // reopen the banner any time, pre-filled with the current choice, so consent is
  // as easy to change as to give (compliance verification 2026-07-06).
  useEffect(() => {
    const reopen = () => {
      const c = getConsent()
      setPerso(c !== 'essential')
      setAds(c === 'all')
      setView('settings')
      setOpenedByUser(true)
      setShow(true)
    }
    window.addEventListener('eno:open-consent', reopen)
    return () => window.removeEventListener('eno:open-consent', reopen)
  }, [])
  if (!show) return null

  /**
   * Closing means closed. Three things reset, and each was a bug found in review:
   *   · CANCEL the pending first-visit timer — otherwise dismissing the footer-opened card at t=2s
   *     without choosing let the timer re-open it at t=4s.
   *   · `view` back to 'ask' — otherwise that same re-open landed on the SETTINGS toggles rather
   *     than the question, pre-filled from a `getConsent()` that had returned null.
   *   · `openedByUser` back to false, so a later automatic appearance cannot inherit "the user
   *     asked for this" from an earlier footer click and steal focus.
   */
  const close = () => {
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
    setShow(false)
    setOpenedByUser(false)
    setView('ask')
  }
  const allow = () => { setConsent('all'); close() }
  const save = () => { setConsent(ads ? 'all' : perso ? 'personalized' : 'essential'); close() }
  const decline = () => { setConsent('essential'); close() }

  // Native copy branch is PRESENTATION-ONLY: same trigger, choices, storage and events —
  // the WebView shares the site's tracking signals, so PDPL consent semantics are identical;
  // only the browser-cookie framing is swapped for app wording. Safe to read inline because
  // the dialog never renders before mount (show starts false).
  const isNative = typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

  const primary = 'rounded-lg px-4 py-1.5 text-sm transition-colors active:scale-[0.96] cursor-pointer'
  const ghost = 'rounded-lg px-3 py-1.5 text-sm font-semibold text-body transition-colors hover:bg-muted hover:text-body active:scale-[0.96] cursor-pointer'

  return (
    /* ⚠️ CENTERED AGAIN (owner, 2026-08-06) — BUT NEVER WITH A BACKDROP. READ THIS BEFORE EDITING.
       An earlier centred version cost THREE Google OAuth verification rejections. It sat over a
       `fixed inset-0 bg-black/40 backdrop-blur-[2px]` backdrop and auto-opened on every first
       visit; Google's brand reviewer is ALWAYS a first visit, so what they screenshotted was a
       dialog on top of a blurred, un-clickable page — reported back as "Your home page is behind a
       login page" and, because the heading was unreadable behind it, "the app name does not match
       the app name on your home page". (The third, "does not explain the purpose", was the sr-only
       <h1> — fixed in c0c3017b.)

       ⚠️ THE CULPRIT WAS THE BACKDROP, NOT THE POSITION — "both complaints, one backdrop", as the
       previous note itself recorded. So centring is safe to restore and the two things that fixed
       the rejection are kept, and must stay kept:
         · `modal={false}` — the page behind stays interactive and un-trapped.
         · `pointer-events-none` on this wrapper (re-armed to `auto` on the card alone) — clicks
           pass through everywhere except the card, so nothing is blocked.
       There is no backdrop element here and there must not be one. If you find yourself adding
       `inset-0 bg-*` or any blur to make the card "pop", that is the exact change that was
       rejected three times.

       The 4s delay above helps the same reviewer for free: they see the home page first.

       Consent semantics are unchanged either way — nothing non-essential fires until a choice is
       stored (src/lib/consent.ts), which is what PDPL requires. A wall was never the mechanism. */
    <DialogPrimitive.Root open={show} modal={false} onOpenChange={(open) => { if (!open) close() }}>
      <DialogPrimitive.Portal>
        {/* Centred in the viewport. `inset-0` here is GEOMETRY ONLY — it is what lets flex centre
            the card — and carries no background or blur; see the note above for why that matters.
            `pointer-events-none` is what keeps a full-viewport element from swallowing every click
            on the page behind it, so it is load-bearing rather than tidy. Padded on all sides so
            the card never touches the edge, and `py-` clears the mobile tab bar / safe area when a
            short viewport pushes it low. */}
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-3 py-[calc(4.5rem+env(safe-area-inset-bottom))] lg:px-4 lg:py-4">
          <DialogPrimitive.Popup
            ref={popupRef}
            /**
             * ⚠️ THE AUTO-PROMPT TAKES NO FOCUS AT ALL; THE USER-OPENED ONE FOCUSES THE CARD.
             * This split exists because of the delay. Focus used to move in the same breath as the
             * page appearing, before anyone could plausibly be typing. Now the card arrives four
             * seconds in, so grabbing focus would take it from a visitor already using the page —
             * someone mid-word in the search field at t=3.5s loses the rest of their keystrokes.
             * Review raised it and it is a real regression the immediate version could not have.
             * `false` leaves focus where the user put it. The footer's "Cookie settings" IS a
             * deliberate request, so that path still focuses.
             *
             * ⚠️ THE TRADE-OFF, STATED RATHER THAN GLOSSED: review is right that a non-modal
             * `role="dialog"` inserted without focus is not guaranteed to be ANNOUNCED, so a screen
             * reader user may not learn the card appeared until they reach it in the tab order. The
             * alternative is worse and was itself a review finding: moving focus four seconds after
             * landing takes it from anyone already typing. Neither option is free, and this one
             * fails toward "the user keeps control of their keyboard" rather than "the user loses a
             * sentence". The card stays reachable by Tab, the footer link reopens it at any time,
             * and nothing non-essential fires until a choice is stored — so a missed announcement
             * delays the prompt, it does not consent on anyone's behalf. Revisit if the pattern
             * changes; do not silently switch it back to stealing focus.
             *
             * Why the CARD rather than the first tabbable thing inside it: Base UI's default is
             * `interactionType === 'touch' ? popup : true`, which put initial focus on the inline
             * "Privacy policy" link mid-sentence and painted a focus ring split across the line
             * wrap (visible on the very first screen of the native app). Deliberately NOT the
             * "Allow" button — pre-focusing the accept action would make Enter consent for the
             * user, and PDPL requires consent be an affirmative act.
             */
            initialFocus={openedByUser ? popupRef : false}
            /* pointer-events-auto re-arms clicks on the card ITSELF — the wrapper disables them so
               the page behind stays usable. Do not move this to the wrapper.
               Zooms in now that it is centred; a slide-from-bottom on a centred card reads as the
               card having missed its mark. */
            /* ⚠️ `max-h-full overflow-y-auto` IS INSURANCE, NOT A FIX FOR A LIVE BUG. Measured on
               844x390 and 740x360 landscape, 360x640 and 320x480: nothing clips and all three
               buttons stay on screen today. But the card has no height cap otherwise, and the copy
               is translated — a longer Vietnamese string, a third language, or one more toggle in
               the settings view would push the actions off a landscape phone with no way to reach
               them. A consent card whose "Decline" cannot be reached is the worst possible failure
               mode here, so it scrolls rather than overflowing. Raised in review. */
            className="pointer-events-auto relative flex max-h-full w-full max-w-md items-center gap-2 overflow-y-auto rounded-2xl bg-popover p-3 shadow-overlay outline-none animate-in fade-in zoom-in-95 duration-200 sm:gap-3.5 sm:p-4 data-closed:animate-out data-closed:fade-out data-closed:zoom-out-95"
          >
            {/* Mascot — fills the card height (the tallest element), minimal padding. */}
        <Mascot name="cookie" className="h-24 w-24 shrink-0 self-center text-foreground sm:h-28 sm:w-28" />

        <div className="min-w-0 flex-1 pr-0.5">
          {view === 'ask' ? (
            <>
              <DialogPrimitive.Title className="text-base font-bold leading-tight text-foreground">
                {isNative
                  ? tr('Personalize your experience?', 'Cá nhân hoá trải nghiệm của bạn?')
                  : tr('Want results made for you?', 'Muốn kết quả dành riêng cho bạn?')}
              </DialogPrimitive.Title>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                {isNative
                  ? tr(
                      'Allow us to put the most relevant products first and to measure what works, so the app keeps getting better for you. ',
                      'Cho phép chúng tôi đưa sản phẩm phù hợp nhất lên đầu và đo lường hiệu quả, để ứng dụng ngày càng hợp với bạn hơn. ',
                    )
                  : tr(
                      'Allow cookies and we’ll put the most relevant products first — and keep you signed in. ',
                      'Cho phép cookie để chúng tôi đưa sản phẩm phù hợp nhất lên đầu — và giữ bạn đăng nhập. ',
                    )}
                <Link href="/privacy" prefetch={false} className="font-semibold text-accent-foreground underline underline-offset-2">{tr('Privacy policy', 'Chính sách quyền riêng tư')}</Link>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <Button variant="cta" size="none" onClick={allow} className={primary}>{tr('Allow', 'Cho phép')}</Button>
                <Button variant="ghost" size="none" onClick={decline} className={ghost}>{tr('Decline', 'Từ chối')}</Button>
                <Button variant="ghost" size="none" onClick={() => setView('settings')} className={ghost}>{tr('Settings', 'Tùy chỉnh')}</Button>
              </div>
            </>
          ) : (
            <>
              <DialogPrimitive.Title className="text-base font-bold leading-tight text-foreground">{tr('Your choices', 'Lựa chọn của bạn')}</DialogPrimitive.Title>
              <div className="mt-1.5 -ml-1.5 space-y-0">
                <Toggle locked value title={tr('Essential', 'Cần thiết')} desc={tr('Sign-in & speed. Always on.', 'Đăng nhập & tốc độ. Luôn bật.')} />
                <Toggle value={perso} onChange={setPerso} title={tr('Personalized', 'Cá nhân hoá')} desc={tr('Rank the most relevant items first from your activity.', 'Xếp hạng mục phù hợp nhất theo hoạt động của bạn.')} />
                <Toggle value={ads} onChange={setAds} title={tr('Ad personalization', 'Quảng cáo cá nhân hoá')} desc={tr('Ad-network signals (Meta/Google) for retargeting.', 'Tín hiệu mạng quảng cáo (Meta/Google) để tiếp thị lại.')} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <Button variant="cta" size="none" onClick={save} className={primary}>{tr('Save', 'Lưu')}</Button>
                <Button variant="ghost" size="none" onClick={decline} className={ghost}>{tr('Decline all', 'Từ chối tất cả')}</Button>
              </div>
            </>
          )}
        </div>
      </DialogPrimitive.Popup>
    </div>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
  )
}
