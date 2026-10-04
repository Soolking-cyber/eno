'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, LogIn } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { clearAccountDeviceStorage } from '@/lib/sign-out-storage'
import type { DashError } from '@/hooks/use-dashboard'

/** How long the fallback below may wait for its cleanup before navigating anyway — navigation never hangs. */
export const SIGN_OUT_FALLBACK_MS = 2000

/**
 * The full-document navigation of the last-resort path, behind an object so a test can observe it
 * (jsdom cannot navigate). `location.replace`: the broken screen should not stay in history.
 */
export const documentNav = {
  replace: (url: string) => { window.location.replace(url) },
}

/**
 * LAST RESORT: drop the Supabase auth cookies directly. They are host-only, `path=/` and NOT httpOnly
 * (src/lib/supabase/cookie-options.ts, and auth-context.tsx on the `sb-…-auth-token` names: the session,
 * its chunks, the PKCE verifiers), so a document with them gone boots with no session even when the client
 * could not be loaded to sign out.
 */
function clearSupabaseAuthCookies(): void {
  try {
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]?.trim()
      if (name && /^sb-.*-auth-token/.test(name)) document.cookie = `${name}=; Max-Age=0; path=/`
    }
  } catch { /* no cookie access (sandboxed) — nothing more this can do */ }
}

/**
 * SIGN IN AGAIN after /api/dashboard answered 401 (inbox-10) — the one implementation every dashboard surface
 * (the listings page, the other sections, the account rail) uses.
 *
 * ⛔ A LOCAL-SCOPE SIGN-OUT. The 401 says THIS browser's session was refused; supabase-js's default 'global'
 * scope would revoke the session on EVERY device — so a false 401 would sign the person out everywhere.
 * ⛔ WITH THE APP'S DEVICE CLEANUP (auth-context signOut: Web Push teardown, clearAccountDeviceStorage, the
 * /post draft photos, the rental basket): a session that expired on a SHARED device may be followed by a
 * different person signing in, who must not inherit the previous account's caches and unkeyed drafts.
 * ⚠️ /signin MUST BE REACHABLE: it bounces anyone the auth context still calls signed in straight back to
 * `next` — the screen that sent them. So the session is gone BEFORE navigating, on every path:
 *   · the standard sign-out clears the context's user whatever the auth server answers → a client-side
 *     navigation;
 *   · if it FAILS part-way (it can throw before it clears anything — its client chunk would not load), the
 *     FALLBACK runs what needs no network: a local sign-out (its SIGNED_OUT event clears the context's user),
 *     this device's per-account data, and the draft-photo and basket cleanup — AWAITED, under one deadline
 *     (SIGN_OUT_FALLBACK_MS), so it can neither be cut short by the navigation nor hang it. (Push teardown
 *     runs first inside signOut, in its own try, so it is behind us by the time the client import can throw.)
 *   · if the local sign-out fails TOO (or is still running at the deadline), nothing in this page can clear
 *     the context's user any more: drop the auth cookies directly and load /signin as a NEW DOCUMENT. It
 *     boots with no session, so /signin cannot bounce — and any sign-out still pending dies with this page,
 *     so it can never sign out the NEXT session.
 * Every await finishes before navigating: a sign-out still running after the next sign-in would sign THAT
 * session out.
 */
export function useSignInAgain(next: string): () => Promise<void> {
  const { signOut } = useAuth()
  const router = useRouter()
  return useCallback(async () => {
    const signin = `/signin?next=${next}`
    try {
      await signOut({ scope: 'local' })
      router.replace(signin)
      return
    } catch { /* the fallback below */ }

    const localSignOut = (async () => {
      const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
      await createSupabaseBrowser().auth.signOut({ scope: 'local' })
      return true
    })().catch(() => false)
    clearAccountDeviceStorage()
    const lazyCleanup = Promise.allSettled([
      import('@/lib/post-draft-photos').then((m) => m.clearDraftPhotos()),
      import('@/lib/rental-check/store').then((m) => { m.clearBasket(); m.clearDraft() }),
    ])
    const localOk = await Promise.race([
      Promise.all([localSignOut, lazyCleanup]).then(([ok]) => ok),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SIGN_OUT_FALLBACK_MS)),
    ])
    if (localOk) {
      router.replace(signin)
      return
    }
    clearSupabaseAuthCookies()
    documentNav.replace(signin)
  }, [signOut, router, next])
}

/**
 * A dashboard surface with NO data says why (inbox-10) — never a skeleton that will not load:
 *   · 'auth'   → "Your session has expired" + Sign in (useSignInAgain);
 *   · 'failed' → the canon's fault coin + Retry.
 * `authSubtitle` / `failedTitle` let a page name what is missing (the listings page does); the defaults are
 * generic. Callers pass `tr(…)` literals so gen-ui-strings harvests them.
 */
export function DashboardFetchError({ error, onRetry, next, authSubtitle, failedTitle }: {
  error: Exclude<DashError, null>
  onRetry: () => void
  /** Where Sign in returns to — this surface's own path. */
  next: string
  authSubtitle?: string
  failedTitle?: string
}) {
  const { tr } = useLanguage()
  const signInAgain = useSignInAgain(next)
  if (error === 'auth') {
    return (
      <EmptyState
        icon={LogIn}
        title={tr('Your session has expired', 'Phiên đăng nhập đã hết hạn')}
        subtitle={authSubtitle}
        action={<Button variant="cta" onClick={() => void signInAgain()}>{tr('Sign in', 'Đăng nhập')}</Button>}
      />
    )
  }
  return (
    // A FAILURE, so the canon's fault coin (neutral disc, destructive ink — icon-language §6), and the alert
    // role on the title so it is announced: the same shape as /saved and the storefront grid.
    <EmptyState
      variant="fault"
      icon={AlertTriangle}
      title={<span role="alert">{failedTitle ?? tr('Something went wrong', 'Đã xảy ra lỗi')}</span>}
      subtitle={tr('Check your connection and try again.', 'Kiểm tra kết nối và thử lại.')}
      action={<Button variant="cta" onClick={onRetry}>{tr('Try again', 'Thử lại')}</Button>}
    />
  )
}
