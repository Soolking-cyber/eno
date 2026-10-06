'use client'

import { useEffect, useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Download, Smartphone, Clock } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { ANDROID_APP_URL, IOS_APP_URL } from '@/lib/app-store-links'
import { isNativeShell } from '@/lib/native-browser'
import { isIOS } from '@/lib/in-app-browser'
import { cn } from '@/lib/utils'

/**
 * "Download the app" — the header's door to the mobile apps, on BOTH editions (owner, 2026-09-16:
 * "add android app link to both domains … tap once android linked ios coming soon", then "put on
 * both" and "something like this qr and it redirects to relevant device store to download make it a
 * download icon").
 *
 * One control, which is why it satisfies both placements the owner described: mounted between the
 * notification bell and the Post button, so on a phone — where Post lives in the bottom nav — it sits
 * immediately right of the bell, and on desktop immediately left of Post.
 *
 * ON BOTH EDITIONS — the owner's standing decision ("put on both", 2026-09-16); do not re-gate it without
 * asking. Since 2026-10-06 (owner: "ship both with eno.vn") the apps render https://eno.vn
 * (capacitor.config.ts server.url), so on eno.vn this points at the licensed marketplace's own app; on
 * eno.forum it now points visitors at an app that renders eno.vn (Android installs older than versionCode
 * 5 still render www.eno.forum).
 *
 * ⛔ WEB ONLY. Inside the Capacitor shell the visitor already has the app. The effect below removes it
 * after hydration, and `html.native [data-app-download]` in globals.css hides it from the first frame
 * (that class is set by layout.tsx's pre-paint script) — a render-time `window` check instead would
 * make the server and client markup disagree.
 */
export function AppDownload() {
  const { tr } = useLanguage()
  const [inApp, setInApp] = useState(false)
  /**
   * ⛔ A PHONE CANNOT SCAN ITS OWN SCREEN. The default — what the SERVER renders — is therefore a plain
   * link to `/app`, which resolves the store for the device that tapped it: the owner's "tap once android
   * linked" (agy caught the panel offering a QR to the one reader guaranteed not to be able to use it).
   * The QR panel is the exception, swapped in once a FINE pointer is confirmed, for the desktop reader who
   * has a phone in the other hand.
   * ⚠️ THE LINK IS THE DEFAULT AND THE PANEL IS THE UPGRADE, NOT THE OTHER WAY AROUND, because the check
   * can only run in the browser: starting from the panel meant every phone rendered the desktop control on
   * the server and swapped it after hydration (agy). This way the majority case is correct in the SSR
   * markup, and the desktop swap costs nothing — the link it replaces goes to a page that lists both
   * stores anyway, which is also the honest answer for an iPad with a trackpad, where the pointer is
   * `fine` and the screen still cannot scan itself.
   */
  const [fine, setFine] = useState(false)
  const [open, setOpen] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  // Explicit, because a failed encode used to leave "Loading…" on screen forever (astra).
  const [qrFailed, setQrFailed] = useState(false)

  useEffect(() => {
    // ⚠️ ALSO GONE ON iOS AND IN AN INSTALLED PWA WHILE THERE IS NO APP STORE LINK (owner-approved O-04,
    // 2026-09-29): there the control's only destination was a "the iOS app is not out yet" page. The
    // pre-paint `no-app-download` class (layout.tsx) hides it from the first frame; this is the belt to
    // that CSS's braces, exactly as for the native shell. Setting NEXT_PUBLIC_IOS_APP_URL restores it.
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
    setInApp(isNativeShell() || (!IOS_APP_URL && (isIOS() || standalone)))
    setFine(window.matchMedia?.('(pointer: fine)').matches ?? false)
  }, [])

  /**
   * ⚠️ THE QR IS DRAWN IN THE BROWSER, ON FIRST OPEN, AND BOTH HALVES OF THAT ARE DELIBERATE.
   * `src/lib/qr-svg.ts` is `server-only` and this is a client component inside a client header, so the
   * encoder has to run here — and it is ~30KB, which has no business in the header's chunk for a panel
   * most visitors never open. A dynamic import on open keeps it out until it is wanted.
   * The payload is THIS SITE's `/app`, so the code works on either domain and the device that scans it
   * is the one whose store it resolves.
   */
  useEffect(() => {
    // A failed encode must not outlive the panel: reopening retries (agy).
    if (!open) { setQrFailed(false); return }
    if (qr) return
    let alive = true
    import('qrcode-generator').then(({ default: qrcode }) => {
      if (!alive) return
      const code = qrcode(0, 'M')
      code.addData(`${window.location.origin}/app`)
      try { code.make() } catch { setQrFailed(true); return }
      // cellSize 4 / margin 4 modules → a ~150px code: comfortably scannable on a phone screen and
      // small enough for the popover. createDataURL, not createSvgTag: the SVG string would have to be
      // injected with dangerouslySetInnerHTML.
      setQr(code.createDataURL(4, 4))
    }).catch(() => { if (alive) setQrFailed(true) })
    return () => { alive = false }
  }, [open, qr])

  if (inApp) return null

  const label = tr('Download the eno app', 'Tải ứng dụng eno')

  // The default branch: one tap, straight to `/app`, which sends the device to its own store.
  if (!fine) {
    return (
      // ⚠️ ui/button + asChild, NOT ui/icon-button: IconButton renders Base UI's Button primitive and takes
      // only <button> props, and a real <a> is worth the four shell utilities here — it long-presses, it
      // opens the Play app directly on Android, and a store link belongs in the page's link graph.
      // The shell classes are IconButton's own (rounded-full, tap-44, its `lg` box) so the two glyphs in
      // this header stay identical; keep them in step if that primitive's sizes change.
      <Button asChild variant="bare" size="none" className="relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full tap-44 text-body transition-[background-color,color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:scale-[0.96]">
        <a href="/app" data-app-download="" aria-label={label}>
          <Download className="h-7 w-7" strokeWidth={1.75} />
        </a>
      </Button>
    )
  }

  const row = 'flex items-center gap-2.5 px-4 py-2.5 text-left text-sm'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <IconButton
            size="lg"
            // The pre-paint `html.native [data-app-download]` rule in globals.css hides this inside the
            // app before the first frame — the effect above is the belt to that CSS's braces.
            data-app-download=""
            aria-label={tr('Download the eno app', 'Tải ứng dụng eno')}
            // Matches the bell's press feel exactly — they are neighbours, and a different scale or
            // duration on one of two adjacent header glyphs reads as a bug.
            className="text-body transition-[background-color,color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:scale-[0.96]"
          >
            <Download className="h-7 w-7" strokeWidth={1.75} />
          </IconButton>
        }
      />
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        aria-label={tr('Download the eno app', 'Tải ứng dụng eno')}
        className="w-60 gap-0 overflow-hidden p-0 shadow-pop ring-0"
      >
        <p className="px-4 pb-2 pt-3 text-sm font-bold text-foreground">{tr('Download the eno app', 'Tải ứng dụng eno')}</p>
        {/* The QR reserves its box whether or not the encoder has landed, so opening the panel does not
            shift the rows under it. A white plate under the code, always: a QR inverted by dark mode
            does not scan on many readers. */}
        <div className="mx-4 mb-2 grid h-[172px] place-items-center rounded-xl bg-white p-2">
          {qr ? (
            /* A data: URI painted in the browser — next/image would round-trip it through the optimizer for nothing. */
            <img
              src={qr}
              alt={tr('QR code — scan to download the eno app', 'Mã QR — quét để tải ứng dụng eno')}
              // ⚠️ AN EXPLICIT SQUARE, NOT h-full w-full. Measured: inside the grid the pair resolved to
              // 192×192 in a 164px-tall box, so the code overhung the caption under it. The encoder's own
              // raster is 108px, so it is being scaled up either way — `pixelated` keeps the module edges
              // hard, which is what a scanner reads; smoothing a QR is how a code becomes flaky.
              className="h-[156px] w-[156px] [image-rendering:pixelated]"
            />
          ) : qrFailed ? (
            // The panel still works without a picture: the store rows below are the same destinations.
            <span className="px-3 text-center text-xs text-ink-4">{tr('QR unavailable — use the links below.', 'Không tạo được mã QR — dùng liên kết bên dưới.')}</span>
          ) : (
            <span className="text-xs text-ink-4">{tr('Loading…', 'Đang tải…')}</span>
          )}
        </div>
        <p className="px-4 pb-2 text-xs text-ink-4">
          {tr('Scan with your phone — it opens the right store.', 'Quét bằng điện thoại — mở đúng cửa hàng ứng dụng.')}
        </p>
        <a
          href={ANDROID_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpen(false)}
          className={cn(row, 'font-semibold text-foreground transition-colors hover:bg-accent active:bg-accent cursor-pointer')}
        >
          <Smartphone className="h-5 w-5 shrink-0 text-ink-4" strokeWidth={1.75} />
          {tr('Google Play', 'Google Play')}
        </a>
        {IOS_APP_URL ? (
          <a
            href={IOS_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={cn(row, 'font-semibold text-foreground transition-colors hover:bg-accent active:bg-accent cursor-pointer')}
          >
            <Smartphone className="h-5 w-5 shrink-0 text-ink-4" strokeWidth={1.75} />
            {tr('App Store', 'App Store')}
          </a>
        ) : (
          // Not a disabled button: there is nothing to press, and a greyed control invites a tap that
          // can never do anything. It is a line of copy that says when to come back.
          <p className={cn(row, 'text-ink-4')}>
            {/* No Apple glyph in the sprite (a trademark, deliberately absent) — a clock says "later". */}
            <Clock className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            {tr('App Store — coming soon', 'App Store — sắp có')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
