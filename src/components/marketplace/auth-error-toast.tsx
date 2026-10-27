'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { refusalToast } from '@/lib/refusal-toast'
import { useAuth } from '@/context/auth-context'
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
  const { user, loading, openSignIn } = useAuth()
  // ⚠️ StrictMode double-invokes effects in development, and a toast is a side effect the user can
  // SEE — without this the message appears twice locally and someone "fixes" it by weakening the
  // dependency array. The ref keys on the value, so a genuine second failure still announces.
  const shown = useRef<string | null>(null)

  const code = params.get('auth_error')

  useEffect(() => {
    // ⚠️ RESET ONCE THE FLAG IS GONE — the strip below removes it — so a genuine SECOND failure with the same code
    // in this page's lifetime announces again. Without this the ref kept the code and swallowed it: the comment
    // above promised the opposite (review, 2026-10-07). StrictMode's double run still sees the flag, so it stays one.
    if (!code) { shown.current = null; return }
    // Every toast's step depends on who is signed in (a popup for someone signed out, a sentence or nothing for someone
    // signed in), so it waits until that is known: a session reads as signed out until the idle boot (an anonymous
    // visitor resolves at once). Review, 2026-10-17 — no_email only then, so a signed-in visitor was offered "Sign in"
    // for every other code (sweep 2026-10-22). Nothing is marked shown or stripped until then.
    if (loading) return
    if (shown.current === code) return
    shown.current = code
    const rest = new URLSearchParams(params.toString())
    rest.delete('auth_error')
    const qs = rest.toString()
    /**
     * ⛔ FACEBOOK SHARED NO EMAIL AND THE VISITOR IS SIGNED OUT: THE POPUP ITSELF, not a toast with a button to it —
     * the emailed code is the way on (SignInContext.emailLead: its field focused, no Facebook button to tap into
     * the same refusal again). The note says why in one line. Owner, 2026-10-17: "if no email register with
     * number", then — with the Quy chế's verified phone or email in front of them — "Email code now".
     */
    if (code === 'no_email' && !user) {
      openSignIn({
        note: tr(
          'Facebook didn’t share your email address. Continue with your email instead — we’ll send you a code.',
          'Facebook không chia sẻ địa chỉ email của bạn. Hãy tiếp tục bằng email — chúng tôi sẽ gửi mã cho bạn.',
        ),
        emailLead: true,
      })
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      return
    }
    const message =
      code === 'signup_disabled'
        ? tr(
            'New sign-ups are closed at the moment, so we could not create your account. If you already have one, sign in with the email you used before.',
            'Hiện chưa mở đăng ký tài khoản mới nên chúng tôi chưa tạo được tài khoản cho bạn. Nếu bạn đã có tài khoản, hãy đăng nhập bằng email đã dùng trước đó.',
          )
        // The provider shared no email address (Facebook: a phone-registered account, or email declined in its dialog) —
        // /auth/callback's `no_email`. Only a visitor who is ALREADY signed in reads this one — signed out, the popup
        // above opens instead — so it says what happened and nothing about creating an account or signing in (review,
        // 2026-10-17: the old sentence told a signed-in visitor to sign in).
        : code === 'no_email'
        ? tr(
            'Facebook didn’t share an email address with us, so that sign-in didn’t go through.',
            'Facebook không chia sẻ địa chỉ email với chúng tôi nên lần đăng nhập đó chưa thực hiện được.',
          )
        // A Facebook identity is never added to an account that already exists (the database guard — /auth/callback's
        // `facebook_linked`): that account keeps the way in it was made with.
        : code === 'facebook_linked'
        ? tr(
            'We could not finish signing you in with Facebook. If this email address already has an account here, sign in the way you did before — with your email code, Google or Apple; Facebook is not added to it.',
            'Chúng tôi chưa hoàn tất đăng nhập bằng Facebook. Nếu địa chỉ email này đã có tài khoản ở đây, hãy đăng nhập như lần trước — bằng mã qua email, Google hoặc Apple; Facebook không được thêm vào tài khoản đó.',
          )
        : tr(
            'We could not finish signing you in. Please try again.',
            'Chúng tôi chưa hoàn tất đăng nhập được. Vui lòng thử lại.',
          )
    // With Sign in, and long enough to read and reach for it (src/lib/refusal-toast.ts): a 27-word sentence about a
    // failed sign-in, on a page the visitor did not choose, used to vanish after 4s with no way to try again but
    // finding the button themselves.
    // The step only for someone signed out — a callback error reaching a signed-in visitor has nothing to retry.
    refusalToast(message, { id: 'auth-error', step: user ? null : { label: tr('Sign in', 'Đăng nhập'), onClick: () => openSignIn() } })
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [code, params, pathname, router, tr, openSignIn, user, loading])

  return null
}
