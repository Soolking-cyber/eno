'use client'

import { useEffect, useState } from 'react'
import { EnoLoader } from '@/components/ui/eno-loader'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { inAppHostName } from '@/lib/in-app-browser'
import type { HandoffVia } from '@/lib/auth/handoff-client'

/**
 * Shown in the REAL BROWSER for the moment between "the app launched me" and "the app finished
 * writing the row". Polls until the Google URL is available, then goes.
 *
 * ⚠️ THE RACE IS DELIBERATE AND UNAVOIDABLE. The app must call openInSystemBrowser inside the live
 * user gesture, so it launches this page before it has asked Supabase for the Google URL. Without
 * this screen the browser would arrive first, find nothing, and bounce to a fresh /signin — which
 * is exactly the disconnected second sign-in the whole design exists to prevent.
 */
export function HandoffLaunch({ nonce, via = null }: { nonce: string; via?: HandoffVia | null }) {
  const { tr } = useLanguage()
  // UX3 J2: name the app the visitor started in (`via`, allow-listed) — never "the eno app" to someone
  // who came from Facebook or Zalo. See the same note in handoff-confirm.tsx.
  const app = inAppHostName(via === 'pwa' ? null : via)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    let stopped = false
    const started = Date.now()
    const tick = async () => {
      if (stopped) return
      // ⚠️ Bounded. If the app never writes the row (it was killed, it lost connectivity), this must
      // say so rather than spin: the visitor still has email and phone waiting in the app.
      if (Date.now() - started > 20_000) { setStuck(true); return }
      try {
        const res = await fetch(`/api/auth/handoff/url?h=${encodeURIComponent(nonce)}`, { cache: 'no-store' })
        const j = (await res.json()) as { ready?: boolean; url?: string }
        if (j.ready && j.url) { window.location.replace(j.url); return }
      } catch { /* retry */ }
      if (!stopped) setTimeout(tick, 500)
    }
    void tick()
    return () => { stopped = true }
  }, [nonce])

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      {!stuck ? (
        <>
          {/* h-6 + accent ink = the app-wide page-wait spinner convention (see handoff-waiting). */}
          <EnoLoader />
          <p className="mt-4 text-sm font-semibold text-muted-foreground">
            {tr('Opening Google…', 'Đang mở Google…')}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-lg font-extrabold tracking-tight text-foreground">
            {tr('Could not start Google sign-in', 'Không thể bắt đầu đăng nhập Google')}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {app
              ? tr('Go back to {app} and try again — or sign in there with a code, no browser needed.', 'Quay lại {app} và thử lại — hoặc đăng nhập bằng mã ngay tại đó, không cần trình duyệt.').replace('{app}', app)
              : tr('Go back to where you started and try again — or sign in there with a code, no browser needed.', 'Quay lại nơi bạn bắt đầu và thử lại — hoặc đăng nhập bằng mã ngay tại đó, không cần trình duyệt.')}
          </p>
          {/* This IS the real browser: /signin here signs in THIS browser, not the app they came from —
              the label says so rather than promising "email or phone" back there. */}
          <Button variant="soft" size="none" type="button" onClick={() => window.location.replace('/signin')} className="mt-5 w-full py-2.5 font-bold">
            {tr('Sign in in this browser instead', 'Đăng nhập trên trình duyệt này')}
          </Button>
        </>
      )}
    </div>
  )
}
