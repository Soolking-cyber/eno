'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { FB_IMPORT_PATH } from '@/lib/fb-import/landing'
import { facebookAvailableHere, facebookIosApp } from '@/lib/facebook-signin'

/**
 * The ad landing's body (src/lib/fb-import/landing.ts): two lines and ONE button, all in the server's HTML; the page puts live
 * listings under it. ⛔ SIGN-IN ONLY ON THE TAP (owner 2026-11-22 "go", after the measured funnel: the sign-in shown on arrival —
 * the whole form from 11-17, the one-action form from 11-20 — was opened ~600 times in six days for 2 method taps and 0
 * sign-ups): the button opens the app's sign-in popup (`openSignIn`, gate `fb_import`), so the gate's `open` now counts TAPS,
 * and arrivals are the page's own loads (rum `account` route). Only claims that hold
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
  const { user, openSignIn } = useAuth()
  const router = useRouter()

  // Can the import run? null = not known yet (the words assume yes, as the server painted them).
  const [importOn, setImportOn] = useState<boolean | null>(null)
  // ⛔ NEVER AN IMPORT BUTTON IN THE iOS APP (the import hands back to the browser there; eno-fb-import app hand-back): the button
  // says Post. Read once at mount, like the rest of this page's browser facts.
  const [iosApp, setIosApp] = useState(false)
  useEffect(() => {
    setIosApp(facebookIosApp())
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
      {/* Signed in already: no button while the on/off answer comes (≤ 8 s) — they are being moved on. The popup is the app's
          one sign-in (its terms line, Facebook first inside Facebook's browser, the iOS app's whole form), so nothing about
          sign-in is decided here; signed in, the effect above moves them on. */}
      {!user && (
        <Button variant="cta" size="lg" className="mt-6 w-full" onClick={() => openSignIn({ gate: 'fb_import' })}>
          {importOn === false || iosApp ? tr('Post a listing', 'Đăng tin') : tr('Import from Facebook', 'Nhập tin từ Facebook')}
        </Button>
      )}
    </>
  )
}
