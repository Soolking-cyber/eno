'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { appleSupportUrl } from '@/lib/apple-signin'
import { leavingForHomeTwin } from '@/lib/app-home-language'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * ⛔ SIGN IN WITH APPLE — THE LAST WORD AFTER A DELETION, WHEN APPLE MAY STILL LIST eno (D9, TN3194). The deletion asks
 * Apple to revoke eno's access (src/lib/core/account-erasure.ts → `apple`): `revoked` and `none` need no word; `queued`
 * (Apple did not answer — retried daily for 14 days) and `manual` (Apple holds no token we can revoke) mean eno may
 * still appear under Sign in with Apple in the person's Apple Account, so they are told so, with Apple's own
 * instructions in their language (appleSupportUrl).
 *
 * ⛔ HANDED TO THE NEXT PAGE, NEVER HELD ON A LIVE SESSION (commit gate B2). The first version kept the deleted
 * account's session alive for as long as the notice showed — signing out unmounts Settings, the only place
 * DeleteAccount renders — and each review round found another way that broke: a tab killed mid-notice kept the
 * cookies; auth-js's refresh (near the JWT's expiry, or on coming back from Apple's page) failed against the deleted
 * user, fired SIGNED_OUT and took the notice with it. Now the deletion signs out at once, as every deletion does, and
 * leaves the notice in sessionStorage — this tab only, never a URL a link could forge — for
 * <AppleDeletionNoticeHost /> (providers.tsx) to show on the page it lands on. Only a tab that cannot store it gets
 * the old in-place notice (DeleteAccount, when handOffAppleNotice answers false).
 * ⚠️ CLEARED WHEN IT IS CLOSED, NOT WHEN IT IS READ (commit gate B3, opus): a page can read it and go before it
 * paints — the app's `/`, replaced by `/vi` for a Vietnamese reader (app-home-language.ts), and React's StrictMode
 * double effect — and a notice taken there would show nowhere. The host also skips that `/` document outright.
 */
export type AppleNotice = 'queued' | 'manual'
export const APPLE_NOTICE_KEY = 'eno:apple-deletion-notice'

/** Leave the notice for the next page in this tab. False when the tab cannot hold it — the caller shows it in place. */
export function handOffAppleNotice(notice: AppleNotice): boolean {
  try {
    sessionStorage.setItem(APPLE_NOTICE_KEY, notice)
    return sessionStorage.getItem(APPLE_NOTICE_KEY) === notice
  } catch {
    return false
  }
}

/** The notice left for this tab, if any. It stays until closed (clearAppleNotice); anything else stored there goes. */
function readAppleNotice(): AppleNotice | null {
  try {
    const v = sessionStorage.getItem(APPLE_NOTICE_KEY)
    if (v === 'queued' || v === 'manual') return v
    if (v !== null) sessionStorage.removeItem(APPLE_NOTICE_KEY)
    return null
  } catch {
    return null
  }
}

function clearAppleNotice(): void {
  try { sessionStorage.removeItem(APPLE_NOTICE_KEY) } catch {}
}

/** The notice's words — title, what happened, Apple's own page — for the host below and DeleteAccount's fallback. */
export function AppleNoticeBody({ notice }: { notice: AppleNotice }) {
  const { tr, lang } = useLanguage()
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{tr('Your account is deleted', 'Tài khoản của bạn đã được xóa')}</AlertDialogTitle>
        <AlertDialogDescription>
          {notice === 'manual'
            ? tr('One last step: eno could not be removed from your Apple Account automatically. Please remove it yourself in your Apple Account settings, under Sign in with Apple.', 'Còn một bước cuối: chưa thể tự động gỡ eno khỏi Tài khoản Apple của bạn. Vui lòng tự gỡ trong phần cài đặt Tài khoản Apple, tại mục Đăng nhập bằng Apple.')
            : tr('We have asked Apple to remove eno from your Apple Account. If eno is still listed under Sign in with Apple in a few days, please remove it yourself in your Apple Account settings.', 'Chúng tôi đã yêu cầu Apple gỡ eno khỏi Tài khoản Apple của bạn. Nếu sau vài ngày eno vẫn còn trong mục Đăng nhập bằng Apple, vui lòng tự gỡ trong phần cài đặt Tài khoản Apple.')}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {/* Apple's own page, in the reader's language (vi-vn for Vietnamese, en-us otherwise). A new tab — and in
          the apps, the system browser — so this notice stays where it is. */}
      <p className="text-sm">
        <a href={appleSupportUrl(lang)} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-foreground underline underline-offset-2">
          {tr('How to stop using Sign in with Apple for an app', 'Cách ngừng dùng Đăng nhập bằng Apple cho một ứng dụng')}
        </a>
      </p>
    </>
  )
}

/** Mounted once (providers.tsx): shows the notice a deletion left for this tab; closing it forgets it. */
export function AppleDeletionNoticeHost() {
  const { tr } = useLanguage()
  const [notice, setNotice] = useState<AppleNotice | null>(null)
  useEffect(() => {
    if (leavingForHomeTwin()) return // this `/` is already being replaced by `/vi`: the notice is for that page
    setNotice(readAppleNotice())
  }, [])
  if (!notice) return null
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) { clearAppleNotice(); setNotice(null) } }}>
      <AlertDialogContent>
        <AppleNoticeBody notice={notice} />
        <AlertDialogFooter>
          <AlertDialogAction className="font-bold">{tr('Done', 'Xong')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
