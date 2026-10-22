'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { ArrowUpRight, ExternalLink } from '@/components/ui/icons'
import { escapeInAppBrowser, escapeUrl, inAppHostName, type InAppHost } from '@/lib/in-app-browser'
import { countTeacherFormEvent } from '@/lib/signup-counters'

/** Who is offered the way out: Meta's own built-in browsers on a phone (teachers/join/page.tsx decides, on the server). */
export type EscapeOffer = { host: InAppHost; os: 'android' | 'ios' }

/**
 * How long the page may still be in front after the tap before the line says how to do it by hand — longer on iOS, where
 * Facebook first asks "Open in Safari?" over a page that stays visible (review round 4).
 */
const STILL_HERE_MS = { android: 1500, ios: 4000 } as const
/** A return to this page within this long after the tap means the hand-over did not hold (a later one: they came back). */
const BACK_SOON_MS = 60_000

/** iOS Facebook and Messenger open Safari itself; Instagram and Android open the phone's default browser. */
const opensSafari = (offer: EscapeOffer) => offer.os === 'ios' && offer.host !== 'instagram'

/**
 * The tap that leaves, shared by both shapes below: counted, handed to the real browser with the escape's mark on the
 * address (in-app-browser.ts escapeUrl — the page that opens there counts the arrival), and — when the page is still in
 * front a moment later, so the app did not let go — the line that says how to leave by hand. `startStill`: the app
 * already kept the page once (it came back here with the mark), so that line shows at once.
 */
function useEscapeTap(offer: EscapeOffer, startStill = false) {
  const [stillHere, setStillHere] = useState(startStill)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tappedAt = useRef(0)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  // The mark is read after the first paint (teacher-form.tsx), so the screen learns it came back once it is up.
  useEffect(() => { if (startStill) setStillHere(true) }, [startStill])
  // ⛔ BACK IN FRONT SOON AFTER A TAP (review, 2026-10-22): the tap can hide this page for longer than the timer — the app
  // switching away, its own sheet, Android's chooser — and when no browser took the link the visitor is back within
  // moments; the timer saw a hidden page and stayed quiet, so the way by hand shows on that return. Only SOON after:
  // a visitor who finished in the browser and opens the app minutes later must not be told it "did not open" (round 3).
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== 'visible' || !tappedAt.current) return
      if (Date.now() - tappedAt.current <= BACK_SOON_MS) setStillHere(true)
      tappedAt.current = 0
    }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [])
  const open = () => {
    tappedAt.current = Date.now()
    countTeacherFormEvent('escape_tap')
    escapeInAppBrowser(escapeUrl(window.location.href, offer.host), offer.host)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (document.visibilityState === 'visible') setStillHere(true) }, STILL_HERE_MS[offer.os])
  }
  return { open, stillHere }
}

/**
 * "OPEN IN YOUR BROWSER" ON teacher.eno.vn's STEP 1, INSIDE FACEBOOK'S, MESSENGER'S OR INSTAGRAM'S BUILT-IN BROWSER (owner,
 * 2026-10-17: "drive them to actual website not in facebook browser"). The bounce study: inside Facebook's browser 2 of
 * 10 teacher sign-ins completed and Google could not finish at all; in a real browser 9 of 10 did.
 * ⛔ SERVER-RENDERED FROM THE USER AGENT, so the first paint already has it and nothing moves when the page hydrates.
 * ⛔ BEFORE ANY ANSWER: it hands this page's own address (with its campaign tags) to the real browser — an Android intent
 * cannot carry the hand-off's `#d=` fragment, so answers would be lost later on (in-app-browser.ts escapeInAppBrowser).
 * Since 2026-10-22 this compact line is the SECOND offer: the first is the whole screen below (EscapeFirst), and this one
 * stays above step 1 for a visitor who chose to go on in the app, until the first answer.
 */
export function OpenInBrowser({ offer }: { offer: EscapeOffer }) {
  const { tr } = useLanguage()
  const { open, stillHere } = useEscapeTap(offer)
  const label = opensSafari(offer)
    ? tr('Open in Safari', 'Mở bằng Safari')
    : tr('Open in your browser', 'Mở bằng trình duyệt')
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-tint p-3.5" data-testid="open-in-browser">
      <p className="min-w-0 flex-1 text-sm text-body">{tr('Signing up is easiest in your browser — Google sign-in works there too.', 'Đăng ký dễ nhất trong trình duyệt — đăng nhập bằng Google cũng dùng được.')}</p>
      <Button variant="cta" size="sm" type="button" onClick={open}>
        <ExternalLink aria-hidden />
        {label}
      </Button>
      {stillHere && (
        <p role="status" className="w-full text-sm text-muted-foreground">{tr('If it did not open: tap ⋯ at the top, then “Open in browser”.', 'Nếu chưa mở: bấm ⋯ ở góc trên, rồi chọn “Mở bằng trình duyệt”.')}</p>
      )}
    </div>
  )
}

/**
 * THE WAY OUT FIRST (owner, 2026-10-22: "remove the in-browser link from the FB ad and creatively route them to normal
 * browser"). Meta has no ad setting that opens the link outside its own browser, and Facebook drops an escape a page
 * scripts on load (in-app-browser.ts escapeInAppBrowser) — so the routing is this screen: in place of step 1, inside
 * Facebook's, Messenger's or Instagram's browser on a phone, before any answer, ONE big tap to the real browser. Measured
 * the day it was asked: in Facebook's browser 1,712 step-1 pages → 70 answered → 6 published, and 13 of 46 sign-ins
 * completed; in a real browser 201 → 95 → 33, and 56 of 67. The inline offer it replaces was tapped 28 times.
 * ⛔ NEVER A WALL: "Continue in Facebook" goes on to step 1 in the app, with the compact offer still above it — a visitor
 * whose app will not let go must never be stuck here.
 * ⛔ The first paint already has it (the server decides from the user agent, like the compact one), so nothing jumps.
 * `retry`: this page came back inside the app WITH the escape's mark — the app loaded the link itself instead of handing
 * it over — so the way by hand shows at once, pointing at the app's ⋯ (top right in Facebook, Messenger and Instagram).
 */
export function EscapeFirst({ offer, retry = false, onStay }: { offer: EscapeOffer; retry?: boolean; onStay: () => void }) {
  const { tr } = useLanguage()
  const { open, stillHere } = useEscapeTap(offer, retry)
  const app = inAppHostName(offer.host) ?? 'Facebook'
  const safari = opensSafari(offer)
  const stay = () => {
    countTeacherFormEvent('escape_stay')
    onStay()
  }
  return (
    <section data-testid="escape-first" aria-labelledby="escape-first-title" className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">{tr('You opened this inside {app}.', 'Bạn đang mở trang này trong {app}.').replace('{app}', app)}</p>
      <h1 id="escape-first-title" data-screen-heading tabIndex={-1} className="h-title text-foreground outline-none">
        {safari
          ? tr('Create your teacher profile in Safari', 'Tạo hồ sơ giáo viên trong Safari')
          : tr('Create your teacher profile in your browser', 'Tạo hồ sơ giáo viên trong trình duyệt')}
      </h1>
      <p className="text-sm text-body">{tr('Free. Schools across Vietnam see your profile; your phone, email and CV stay private until you share them.', 'Miễn phí. Các trường trên toàn Việt Nam xem được hồ sơ; số điện thoại, email và CV được giữ kín đến khi bạn chia sẻ.')}</p>
      <p className="text-sm text-body">{tr('Google sign-in works there. Once you sign in, your answers are saved, so you can finish on a laptop.', 'Đăng nhập bằng Google dùng được ở đó. Sau khi đăng nhập, câu trả lời được lưu, nên bạn có thể hoàn tất trên máy tính.')}</p>
      <Button variant="cta" size="lg" type="button" className="w-full" onClick={open}>
        <ExternalLink aria-hidden />
        {safari ? tr('Open in Safari', 'Mở bằng Safari') : tr('Open in your browser', 'Mở bằng trình duyệt')}
      </Button>
      {safari && <p className="text-sm text-muted-foreground">{tr('If your phone asks “Open in Safari?”, tap Open.', 'Nếu điện thoại hỏi “Mở bằng Safari?”, hãy chọn Mở.')}</p>}
      {/* ⛔ TRUE WHENEVER IT SHOWS (review round 4): this page cannot know whether the hand-over held — the app's own "Open
          in Safari?" leaves it visible, a quick look back after a good hand-over looks the same — so it says only what is
          so ("still here?") and keeps the line above, never "it did not open". */}
      {stillHere && (
        <>
          <p role="status" className="text-sm font-semibold text-foreground">{tr('Still here? Tap ⋯ at the top right, then “Open in browser”.', 'Vẫn ở đây? Bấm ⋯ ở góc trên bên phải, rồi chọn “Mở bằng trình duyệt”.')}</p>
          {/* Points at the app's own ⋯, which sits just above this page's top-right corner in all three apps. */}
          <ArrowUpRight aria-hidden data-testid="escape-pointer" className="pointer-events-none fixed right-2 top-2 z-50 size-10 text-cta motion-safe:animate-bounce" />
        </>
      )}
      <Button variant="ghost" type="button" onClick={stay}>
        {tr('Continue in {app}', 'Tiếp tục trong {app}').replace('{app}', app)}
      </Button>
    </section>
  )
}
