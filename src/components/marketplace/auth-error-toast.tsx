'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'

/**
 * TELLS A VISITOR THAT THEIR SIGN-IN FAILED. Nothing did.
 *
 * ⛔ THE BUG THIS CLOSES IS THE SILENCE, NOT THE FAILURE. /auth/callback has always redirected a
 * failed sign-in to `/?auth_error=1`, and a grep for `auth_error` across src found the two routes
 * that WRITE it and not one line that READS it. So a failed Google sign-in dropped the visitor on
 * the home page, signed out, with no message of any kind — indistinguishable from "nothing
 * happened", which is exactly how the owner described it (2026-08-17: "google login once loggin it
 * doesnt and you have to log in again"). The retry then worked and the first attempt looked like a
 * glitch rather than a reported error.
 *
 * ⚠️ THE REAL FIRST-ATTEMPT CAUSE IS A SUPABASE PROJECT SETTING, and this component does not fix
 * it — it makes it visible. `/auth/v1/settings` on the live project answers `"disable_signup": true`
 * (measured 2026-08-18), so Google sign-in by anyone the project does not already know is refused
 * with `signup_disabled`, which production logged on 2026-08-17. A visitor now reads that sign-ups
 * are closed instead of being bounced in silence.
 *
 * ⚠️ THE PARAM IS STRIPPED AFTER IT IS READ. Without that, the flag survives in the URL: a reload,
 * a share, or a back-navigation would re-announce a failure that already happened. `replace`, not
 * `push`, so the cleaned URL does not add a history entry the back button has to walk through.
 */
export function AuthErrorToast() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const { tr } = useLanguage()
  // ⚠️ StrictMode double-invokes effects in development, and a toast is a side effect the user can
  // SEE — without this the message appears twice locally and someone "fixes" it by weakening the
  // dependency array. The ref keys on the value, so a genuine second failure still announces.
  const shown = useRef<string | null>(null)

  const code = params.get('auth_error')

  useEffect(() => {
    if (!code || shown.current === code) return
    shown.current = code
    const message =
      code === 'signup_disabled'
        ? tr(
            'New sign-ups are closed at the moment, so we could not create your account. If you already have one, sign in with the email you used before.',
            'Hiện chưa mở đăng ký tài khoản mới nên chúng tôi chưa tạo được tài khoản cho bạn. Nếu bạn đã có tài khoản, hãy đăng nhập bằng email đã dùng trước đó.',
          )
        : tr(
            'We could not finish signing you in. Please try again.',
            'Chúng tôi chưa hoàn tất đăng nhập được. Vui lòng thử lại.',
          )
    toast.error(message)

    const rest = new URLSearchParams(params.toString())
    rest.delete('auth_error')
    const qs = rest.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [code, params, pathname, router, tr])

  return null
}
