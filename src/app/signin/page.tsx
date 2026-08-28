'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from "@/components/ui/icons"
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInCard } from '@/components/marketplace/sign-in-card'
import { safeNextPath } from '@/lib/url'
import { COMPANY } from '@/lib/site-legal'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'

// The sign-in ROUTE. Renders the app's one sign-in card (the same one the popup shows) because a
// server `redirect('/signin?next=…')` cannot open a dialog. Honors ?next= for the post-login
// redirect and bounces already-signed-in users away.
function SignInPageInner() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const raw = params.get('next') || '/'

  useEffect(() => {
    if (!user) return
    // Sanitize ?next= to a same-origin path (shared open-redirect guard).
    router.replace(safeNextPath(raw, window.location.origin))
  }, [user, raw, router])

  return (
    /**
     * ⛔ THE SAME CARD AS THE POPUP, ON A PLAIN GROUND — owner, 2026-08-28: "unify all login signup
     * pages to this only 1 popup dont use other than this anywhere across the app where it is".
     * This was a split layout with its own navy brand panel, an `h-display` headline, three trust
     * bullets and a mascot: a second, richer answer to "what does signing in look like" that a
     * visitor met only if a server redirect sent them here. `<SignInCard>` is the popup's contents,
     * so the two cannot drift again.
     *
     * ⚠️ THE ROUTE HAS TO SURVIVE EVEN THOUGH THE DESIGN IS A POPUP, and that is not a compromise —
     * twelve server-side guards `redirect('/signin?next=…')`, and a server redirect cannot open a
     * dialog. A page also has to answer with no JavaScript, with no page behind it to dismiss to.
     * So: same card, page frame.
     * ⚠️ AND THE OPERATOR BLOCK STAYS. Đ.36 wants the operator identifiable on every public page and
     * this layout has no Footer — dropping it with the brand panel would have been a silent
     * compliance regression, since nothing renders it here but this file.
     */
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center">
          {/* `?v=` is a content stamp that earns this file `max-age=31536000, immutable`
              (next.config.ts gates the year on the query being present). It is repeated at four
              call sites and MUST be bumped at all four when the mark is redrawn — the full
              reasoning and the recompute command live in marketplace/footer.tsx. */}
          <img src="/logo-mark.svg?v=d88a7892" alt={SITE_NAME} width={48} height={48} className="h-12 w-12" />
        </Link>
        {/* ⚠️ `h1`, NOT `h2`. The brand panel this replaced held the page's only `<h1>`, and
            shipping the card at h2 left a public route with no level-one heading — a
            heading-order failure a reviewer caught. The popup passes `DialogTitle` here instead;
            see the note on `titleAs`. */}
        <SignInCard titleAs="h1" />
        <Link href="/" className="mt-8 flex items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-accent-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />{' '}
          {/* ⚠️ Two literal tr() calls behind the ternary, never an interpolation — see the same
              note in sign-in-card.tsx. This said "Back to eno.vn" on BOTH editions; measured on a
              real forum build, that was the last eno.vn string left on the page. */}
          {IS_SERVICES ? tr('Back to eno.forum', 'Về trang chủ') : tr('Back to eno.vn', 'Về trang chủ')}
        </Link>
        {/* Operator identity — this layout has no Footer, and Đ.36 wants the operator identifiable
            on every public page. Compact single block behind a hairline. */}
        <p className="mt-8 border-t border-border/60 pt-4 text-center text-3xs leading-relaxed text-ink-4">
          {COMPANY.name} · {COMPANY.address} · {tr('Business reg. no.', 'GCN ĐKDN số')}: {COMPANY.erc} · {COMPANY.email}
        </p>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <>
      {/* Outside the Suspense boundary so it's in the static HTML even when the
          searchParams-reading inner page prerenders as the fallback. noscript
          can't run the language hook — static EN + VI. */}
      <noscript>
        {/* No JS ⇒ no client i18n — deliberately static bilingual copy. */}
        {/* eslint-disable react/jsx-no-literals */}
        <div className="mx-auto my-4 max-w-sm rounded-xl bg-warning/10 px-4 py-3 text-center text-sm text-foreground">
          <p className="font-semibold">Sign in needs JavaScript enabled.</p>
          <p>Đăng nhập cần bật JavaScript trong trình duyệt.</p>
        </div>
        {/* eslint-enable react/jsx-no-literals */}
      </noscript>
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <SignInPageInner />
      </Suspense>
    </>
  )
}
