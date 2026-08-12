'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { isIOS } from '@/lib/in-app-browser'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

// Store links — set by the owner once the apps are published (env, so no code change to flip on).
// iOS needs Apple's numeric app id (assigned at submission); Android is predictable but the app
// still has to be live. Until BOTH exist the prompt stays hidden (no dead links).
//   NEXT_PUBLIC_IOS_APP_URL      e.g. https://apps.apple.com/app/id0000000000
//   NEXT_PUBLIC_ANDROID_APP_URL  e.g. https://play.google.com/store/apps/details?id=vn.eno.app
const IOS_URL = process.env.NEXT_PUBLIC_IOS_APP_URL
const ANDROID_URL = process.env.NEXT_PUBLIC_ANDROID_APP_URL

const DISMISS_KEY = 'eno-app-hint-dismissed'
const VISITS_KEY = 'eno-visits'
const SESSION_KEY = 'eno-visit-counted'

/**
 * "Get the eno app" prompt — WEB ONLY, and only when we have a store link for the visitor's phone.
 *
 * Renders NOTHING inside the native Capacitor app (you already have it — window.Capacitor is
 * present) and NOTHING on desktop or when the matching store URL isn't configured yet. On mobile
 * web it points iOS visitors to the App Store and Android visitors to Google Play. Same engagement
 * gating the old add-to-home-screen hint used: returning visitors after a 4s settle, an engaged
 * first-timer after dwell — never a first-load banner. Dismiss (✕) sets a forever flag.
 */
export function InstallHint() {
  const { tr } = useLanguage()
  const [mode, setMode] = useState<'ios' | 'android' | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Inside the native app already — nothing to download.
      if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) return
      if (localStorage.getItem(DISMISS_KEY)) return

      // Which store, and do we even have a link for it? (Desktop → neither → skip.)
      const ios = isIOS()
      const url = ios ? IOS_URL : ANDROID_URL
      if (!url) return

      // Engagement gate: returning visitor gets it quickly (4s settle); an engaged FIRST-timer
      // earns it by dwell (75s) — never a first-load banner, which burns the one-shot ask.
      let visits = parseInt(localStorage.getItem(VISITS_KEY) || '0', 10) || 0
      if (!sessionStorage.getItem(SESSION_KEY)) {
        visits += 1
        localStorage.setItem(VISITS_KEY, String(visits))
        sessionStorage.setItem(SESSION_KEY, '1')
      }
      const delay = visits >= 2 ? 4000 : 75_000
      timer = setTimeout(() => setMode(ios ? 'ios' : 'android'), delay)
    } catch {
      /* storage blocked — silently skip */
    }
    return () => { if (timer) clearTimeout(timer) }
  }, [])

  if (!mode) return null
  const url = mode === 'ios' ? IOS_URL : ANDROID_URL
  if (!url) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setMode(null)
  }

  const store = mode === 'ios' ? tr('the App Store', 'App Store') : tr('Google Play', 'Google Play')

  return (
    <div
      role="dialog"
      aria-label={tr('Get the eno app', 'Tải ứng dụng eno')}
      // 4.5rem tracks <BottomNavSpacer/> — the tab bar's real height. At the stale 4rem this
      // sat half a rem too low and clipped behind the nav.
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 lg:bottom-4 lg:px-4"
    >
      <div className="mx-auto flex w-full max-w-md items-center gap-3 rounded-t-2xl bg-card p-3.5 shadow-overlay animate-in fade-in slide-in-from-bottom-4 duration-300 lg:rounded-2xl">
        <Image src="/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight text-foreground">
            {tr('Get the eno app', 'Tải ứng dụng eno')}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {tr(`Faster, with notifications — on ${store}`, `Nhanh hơn, có thông báo — trên ${store}`)}
          </p>
        </div>
        <Button asChild variant="cta" size="sm" className="shrink-0">
          {/* External store link — new context; rel guards the opener. */}
          <a href={url} target="_blank" rel="noopener noreferrer" onClick={dismiss}>
            {tr('Get', 'Tải')}
          </a>
        </Button>
        <IconButton
          size="sm"
          type="button"
          aria-label={tr('Dismiss', 'Đóng')}
          onClick={dismiss}
          className="text-ink-4 transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}
