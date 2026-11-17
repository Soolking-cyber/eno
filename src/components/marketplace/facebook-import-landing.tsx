'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInForm } from '@/components/marketplace/sign-in-form'
import { noteGateOpen } from '@/lib/signin-gates'
import { FB_IMPORT_PATH } from '@/lib/fb-import/landing'
import { facebookAvailableHere, facebookIosApp } from '@/lib/facebook-signin'

/**
 * The ad landing's body (src/lib/fb-import/landing.ts): two lines and the sign-in, all in the server's HTML. Only claims that hold
 * for every listing: free to post, brought over from Facebook without retyping, shown in Vietnamese and English (every listing is
 * published in both — the import refuses one whose other language could not be written), checked by the seller before it goes up.
 * The import's own notice (what is read, which AI) stays on the import, before Connect. eno.vn by name: eno.forum is gone (owner,
 * 2026-11-15 — no edition-aware wording for new eno.vn work).
 * ⛔ NEVER A SIGN-UP INTO A DEAD END (commit gate, opus): when the import is switched off (Facebook can pause it) or cannot run in
 * this browser, the line says so and a sign-in here goes on to the post form instead — the same on/off answer and 8 s cap as the
 * import panel's guest view.
 */
export function FacebookImportLanding() {
  const { tr } = useLanguage()
  const { user, loading } = useAuth()
  const router = useRouter()

  // Its own gate in the sign-in counters, once per visit and only for a guest.
  const counted = useRef(false)
  useEffect(() => {
    if (loading || user || counted.current) return
    counted.current = true
    noteGateOpen('fb_import')
  }, [loading, user])

  // Can the import run? null = not known yet (the words assume yes, as the server painted them).
  const [importOn, setImportOn] = useState<boolean | null>(null)
  useEffect(() => {
    if (!(facebookAvailableHere() || facebookIosApp())) { setImportOn(false); return }
    let live = true
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8_000)
    void fetch('/api/fb-import/available', { cache: 'no-store', signal: ctl.signal }).then((r) => (r.ok ? r.json() : null))
      .then((d: { on?: boolean } | null) => { if (live) setImportOn(!!d?.on) }).catch(() => { if (live) setImportOn(false) })
      .finally(() => clearTimeout(timer))
    return () => { live = false; clearTimeout(timer); ctl.abort() }
  }, [])

  // Signed in (already, or just now with the emailed code): on to the import — or the post form when it can't run.
  // Waits for the on/off answer (≤ 8 s), so a signed-in visitor moves once, to the right place.
  useEffect(() => { if (user && importOn !== null) router.replace(importOn ? FB_IMPORT_PATH : '/post') }, [user, importOn, router])

  return (
    <>
      <h1 className="h-title text-balance text-ink">{tr('Post your Marketplace listings on eno.vn, free', 'Đăng tin Marketplace lên eno.vn, miễn phí')}</h1>
      <p className="mt-2 text-body">
        {importOn === false
          ? tr(
              'Importing from Facebook isn’t available here right now, but you can post with the form. Shown in Vietnamese and English.',
              'Hiện chưa nhập được từ Facebook ở đây, nhưng bạn vẫn đăng được bằng biểu mẫu. Tin hiện bằng tiếng Việt và tiếng Anh.',
            )
          : tr(
              'Bring them over from Facebook, no retyping. Shown in Vietnamese and English; you check each one before it goes up.',
              'Nhập từ Facebook, không cần gõ lại. Tin hiện bằng tiếng Việt và tiếng Anh; bạn duyệt từng tin trước khi đăng.',
            )}
      </p>
      {/* Signed in already: no second sign-in to start while the on/off answer comes (≤ 8 s) — they are being moved on. */}
      {!user && <SignInForm className="mt-6" gate="fb_import" />}
    </>
  )
}
