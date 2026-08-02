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

/** Sleek, compact consent banner — a horizontal card with the shield mascot filling
 *  the height on the left and tight copy + slim actions on the right. "Allow" turns on
 *  personalized recommendations + ad signals; "Settings" fine-tunes each or declines. */
export function CookieConsent() {
  const { tr } = useLanguage()
  // Where initial focus goes when the dialog opens — see initialFocus on the Popup below.
  const popupRef = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)
  const [view, setView] = useState<'ask' | 'settings'>('ask')
  const [perso, setPerso] = useState(true)
  const [ads, setAds] = useState(true)

  // Mirror any pre-cookie-era consent into the server-readable cookie, then
  // only prompt users who have never chosen.
  useEffect(() => { syncConsentCookie(); if (getConsent() === null) setShow(true) }, [])

  // Withdrawal right (PDPL): the footer "Cookie settings" link dispatches this to
  // reopen the banner any time, pre-filled with the current choice, so consent is
  // as easy to change as to give (compliance verification 2026-07-06).
  useEffect(() => {
    const reopen = () => {
      const c = getConsent()
      setPerso(c !== 'essential')
      setAds(c === 'all')
      setView('settings')
      setShow(true)
    }
    window.addEventListener('eno:open-consent', reopen)
    return () => window.removeEventListener('eno:open-consent', reopen)
  }, [])
  if (!show) return null

  const close = () => setShow(false)
  const allow = () => { setConsent('all'); close() }
  const save = () => { setConsent(ads ? 'all' : perso ? 'personalized' : 'essential'); close() }
  const decline = () => { setConsent('essential'); close() }

  // Native copy branch is PRESENTATION-ONLY: same trigger, choices, storage and events —
  // the WebView shares the site's tracking signals, so PDPL consent semantics are identical;
  // only the browser-cookie framing is swapped for app wording. Safe to read inline because
  // the dialog never renders before mount (show starts false).
  const isNative = typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

  const primary = 'rounded-lg px-4 py-1.5 text-sm transition-colors active:scale-95 cursor-pointer'
  const ghost = 'rounded-lg px-3 py-1.5 text-sm font-semibold text-body transition-colors hover:bg-muted hover:text-body active:scale-95 cursor-pointer'

  return (
    /* ⚠️ NON-MODAL, AND NOT A CENTERED DIALOG — THIS COST THREE GOOGLE VERIFICATION REJECTIONS.
       It used to be a centred popup over a `fixed inset-0 bg-black/40 backdrop-blur-[2px]`
       backdrop, auto-opened on every first visit. Google's OAuth brand reviewer is ALWAYS a first
       visit, so what they saw was a dialog on top of a blurred, un-clickable page — reported back
       as "Your home page is behind a login page" and, because the heading was unreadable behind
       it, "the app name does not match the app name on your home page". Both complaints, one
       backdrop. (The third, "does not explain the purpose", was the sr-only <h1> — fixed in
       c0c3017b.)
       `modal={false}` keeps the page interactive and un-trapped; the wrapper is
       pointer-events-none so only the card itself takes clicks. Consent is unchanged: nothing
       non-essential fires until a choice is stored (src/lib/consent.ts), which is what PDPL
       actually requires — a wall was never the compliance mechanism. */
    <DialogPrimitive.Root open={show} modal={false} onOpenChange={(open) => { if (!open) close() }}>
      <DialogPrimitive.Portal>
        {/* Bottom-anchored, clearing the mobile tab bar exactly like install-hint.tsx —
            4.5rem + safe-area on small screens, normal inset on desktop. */}
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[200] flex justify-center px-3 lg:bottom-4 lg:px-4">
          <DialogPrimitive.Popup
            ref={popupRef}
            // Focus the CARD, not the first tabbable thing inside it. Base UI's default is
            // `interactionType === 'touch' ? popup : true`, and this dialog AUTO-OPENS on first
            // visit (no trigger, so not the touch branch) — which put initial focus on the inline
            // "Privacy policy" link mid-sentence, painting a focus ring split across the line wrap
            // (visible on the very first screen of the native app). Focusing the popup is the same
            // element Base UI already picks for touch: the title is still announced to screen
            // readers, and no control gets a ring. Deliberately NOT the "Allow" button — pre-focusing
            // the accept action on a consent dialog would make Enter consent for the user (PDPL:
            // consent must be an affirmative act).
            initialFocus={popupRef}
            /* pointer-events-auto re-arms clicks on the card itself (the wrapper disables them so
               the page behind stays usable). Slides up from the bottom now rather than zooming
               into the middle. */
            className="pointer-events-auto relative flex w-full max-w-md items-center gap-2 overflow-hidden rounded-2xl bg-popover p-3 shadow-overlay outline-none animate-in fade-in slide-in-from-bottom-4 duration-200 sm:gap-3.5 sm:p-4 data-closed:animate-out data-closed:fade-out"
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
