'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X, Share } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { isIOS, googleOauthBlocked } from '@/lib/in-app-browser'
import { Button } from '@/components/ui/button'

/**
 * "Add to Home Screen" education — the last unlit PWA step.
 *
 * Renders NOTHING on first paint (and nothing at all for most visitors). After
 * mount it checks, in order: not already installed (standalone), not previously
 * dismissed, and an engagement signal (2nd+ visit via a self-maintained
 * localStorage counter, bumped once per session). When all pass:
 *   - iOS Safari (not in-app webviews, not CriOS/FxiOS): after a 4s idle delay,
 *     a slim bottom sheet with Share → Add-to-Home-Screen instructions.
 *   - Android/desktop Chrome: we stash the `beforeinstallprompt` event and show
 *     the same sheet with a real Install button that calls prompt().
 * Dismissing (✕) sets a forever flag. Zero work on the initial-paint path — one
 * effect, one timer, no network.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'eno-install-hint-dismissed'
const VISITS_KEY = 'eno-visits'
const SESSION_KEY = 'eno-visit-counted'

export function InstallHint() {
  const { tr } = useLanguage()
  const [mode, setMode] = useState<'ios' | 'android' | null>(null)
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let onBip: ((e: Event) => void) | undefined
    try {
      // Already running as an installed app? Nothing to teach.
      if (matchMedia('(display-mode: standalone)').matches) return
      if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return
      if (localStorage.getItem(DISMISS_KEY)) return

      // Engagement signal: visit counter, +1 once per browser session.
      let visits = parseInt(localStorage.getItem(VISITS_KEY) || '0', 10) || 0
      if (!sessionStorage.getItem(SESSION_KEY)) {
        visits += 1
        localStorage.setItem(VISITS_KEY, String(visits))
        sessionStorage.setItem(SESSION_KEY, '1')
      }
      // Engagement gate: returning visitors get the hint quickly (4s settle);
      // an engaged FIRST-time visitor earns it by dwell (75s on site) — never a
      // first-load banner, which burns the one-shot ask (near-guaranteed dismissal).
      const delay = visits >= 2 ? 4000 : 75_000

      // Android / Chrome: the browser tells us installability — stash the event.
      onBip = (e: Event) => {
        e.preventDefault()
        setInstallEvt(e as BeforeInstallPromptEvent)
        if (!timer) timer = setTimeout(() => setMode('android'), delay)
      }
      window.addEventListener('beforeinstallprompt', onBip)

      // iOS: Safari only (real Safari — in-app webviews and Chrome/Firefox-on-iOS
      // shells don't offer the same Share → Add-to-Home-Screen path).
      const iosSafari =
        isIOS() && !googleOauthBlocked() && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(navigator.userAgent)
      if (iosSafari) timer = setTimeout(() => setMode('ios'), delay)
    } catch {
      /* storage blocked / matchMedia missing — silently skip the hint */
    }
    return () => {
      if (onBip) window.removeEventListener('beforeinstallprompt', onBip)
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!mode) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setMode(null)
  }
  const install = async () => {
    try { await installEvt?.prompt() } catch { /* user cancelled / already used */ }
    dismiss()
  }

  return (
    <div
      role="dialog"
      aria-label={tr('Add eno.vn to your Home Screen', 'Thêm eno.vn vào Màn hình chính')}
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 lg:bottom-4 lg:px-4"
    >
      <div className="mx-auto flex w-full max-w-md items-center gap-3 rounded-t-2xl bg-card p-3.5 shadow-overlay animate-in fade-in slide-in-from-bottom-4 duration-300 lg:rounded-2xl">
        <Image src="/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-tight text-foreground">
            {tr('Add eno.vn to your Home Screen', 'Thêm eno.vn vào Màn hình chính')}
          </p>
          {mode === 'ios' ? (
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
              {tr('Tap', 'Nhấn')}{' '}
              <Share aria-label="Share" className="inline h-3.5 w-3.5 align-[-2px] text-accent-foreground" />{' '}
              {tr('then “Add to Home Screen”', 'rồi chọn “Thêm vào MH chính”')}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
              {tr('One tap — opens like an app, no store needed', 'Một chạm — mở như ứng dụng, không cần cửa hàng')}
            </p>
          )}
        </div>
        {mode === 'android' && (
          <Button variant="cta" size="sm" onClick={install} className="shrink-0">
            {tr('Install', 'Cài đặt')}
          </Button>
        )}
        <button
          type="button"
          aria-label={tr('Dismiss', 'Đóng')}
          onClick={dismiss}
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted cursor-pointer tap-44"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
