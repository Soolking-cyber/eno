'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MessageSquare, Flag, ArrowLeft } from '@/components/ui/icons'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInForm } from '@/components/marketplace/sign-in-form'
import { EnoSeal } from '@/components/marketplace/eno-seal'
import { Mascot } from '@/components/marketplace/mascot'
import { safeNextPath } from '@/lib/url'
import { COMPANY } from '@/lib/site-legal'
import { SITE_NAME } from '@/lib/edition'

// Dedicated split-layout sign-in page (commerce-login pattern, eno.vn blue). Reuses
// the exact same <SignInForm> as the inline modal. Honors ?next= for post-login
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
    <div className="grid min-h-screen w-full bg-background md:grid-cols-2">
      {/* Brand panel (desktop) — muted deep navy-blue (calmer than the vivid accent) */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-deep to-brand-deeper p-12 text-white md:flex">
        {/* Mascot with a key (access) — anchored in the empty lower-right */}
        <Mascot name="key" white className="pointer-events-none absolute bottom-8 right-8 h-72 w-72 opacity-[0.13] lg:h-96 lg:w-96" />
        <Link href="/" className="relative text-2xl font-extrabold tracking-tight">eno.vn</Link>
        <div className="relative">
          {/* `h-display`, not a fixed off-scale utility step. §1 of the canon caps the markup scale
              at 3xl/30px and routes anything larger through the FLUID display class
              (clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem) × 1.12), which is what the other ten h1s in
              the app use. This heading was the app's ONLY off-scale one — grep confirms nothing
              else exceeds 3xl.

              ⚠️ THE "MOBILE" ARGUMENT FOR CHANGING IT IS WRONG, so don't restate it: this panel is
              `hidden … md:flex`, so it never renders below 768px and a fixed 36px never reached a
              phone. The real argument is the COLUMN. The panel is one half of `md:grid-cols-2`
              minus p-12, so its content width is (viewport / 2 − 96px): 288px at 768, 416px at
              1024, 624px at 1440. A viewport-driven clamp tracks that exactly — 33.9px at 768,
              37.8px at 1024, 40px from ~1173 up — whereas a flat 36px was heaviest relative to the
              column precisely where the column was narrowest, wrapping the English string across
              three lines at the breakpoint. Fluid is SMALLER than the old value where it was
              crowded and larger where there is room.

              Weight drops 800 → 700 with the class, and that is intended: `.h-display` is plain
              unlayered CSS in globals.css, so it beats a `@layer utilities` font-weight utility —
              keeping one here would have been a class that silently did nothing. 700 is also what
              every other page title in the app renders at. Colour still comes from the panel's own
              `text-white` (these type classes never set colour). */}
          <h1 className="h-display">{tr('e-commerce with no drama', 'Mua bán không drama.')}</h1>
          <p className="mt-3 max-w-sm text-base text-blue-100">
            {tr("Vietnam's trusted marketplace for the international community.", 'Chợ uy tín cho cộng đồng quốc tế tại Việt Nam.')}
          </p>
          {/* Trust bullets — h-5 list leads (icon-language §4), stroke UI-default.
              · Bullet 1 IS the trust badge the copy describes, so it shows the eno seal —
                the §0b signature replacing lucide BadgeCheck in a first-party trust moment —
                and it takes variant="wash": the ladder's own table says safety bullets carry
                the WASHED chief, and the chief is the one place the signature is authored in.
                R1 shipped it as variant="line" ("colored surface ⇒ no wash") and the round-2
                critic cited that as a letter violation — the §6 no-wash rule is about CHROME
                (carets, ✕, idle nav), not about a trust mark on a brand panel. brand-100 reads
                as a light tint over the fixed navy — in LIGHT mode. This panel never flips
                (brand-deep/deeper are theme-fixed, hence the fixed text-blue-* inks around it),
                but fill-brand-100 DOES flip, to a navy so close to the panel that the chief
                shipped invisible in dark (measured on the R2 dark shot). So the chief is pinned
                to a fixed white tint IN BOTH THEMES — the same move as the mascot's
                white-at-low-opacity: fixed surface ⇒ fixed ink, all the way. R2 pinned only
                dark:, which left the SAME seal on the SAME never-flipping pixels rendering two
                ways depending on the viewer's theme — drift by §0b's own definition, and the R3
                critic caught the dark crops disagreeing mid-round. One selector, no theme
                prefix, one render. It outranks the chief's own .fill-brand-100 (class+type vs
                class), which is what lets a call-site adapt the wash without touching the
                seal's frozen geometry.
              · Bullet 3 uses Flag, the app-wide report vocabulary (report-button.tsx), not a
                lucide shield (§0b retires those) and not a second seal — one stamp per panel
                keeps the signature worth something. */}
          <ul className="mt-8 space-y-3 text-sm text-blue-50">
            <li className="flex items-center gap-2.5"><EnoSeal variant="wash" className="h-5 w-5 shrink-0 [&>path:first-of-type]:fill-white/35" /> {tr('Sellers earn a trust badge — reputation you can see', 'Người bán xây dựng uy tín — huy hiệu minh bạch')}</li>
            <li className="flex items-center gap-2.5"><MessageSquare className="h-5 w-5 shrink-0" /> {tr('Message safely in-app — your number stays private', 'Nhắn tin an toàn — số của bạn được giữ kín')}</li>
            <li className="flex items-center gap-2.5"><Flag className="h-5 w-5 shrink-0" /> {tr('Spot something off? Report it in one tap', 'Thấy bất thường? Báo cáo chỉ một chạm')}</li>
          </ul>
        </div>
        <p className="relative text-xs text-blue-200">© {new Date().getFullYear()} eno.vn · {tr('Made in Saigon', 'Làm tại Sài Gòn')}</p>
      </div>

      {/* Form column — header/copy centered so every stage (tabs, code entry, the
          "check your email" success) reads as ONE centered composition; the form's
          inputs stay full-width inside the column. A hairline seam in dark mode
          keeps the navy brand panel and the near-black canvas from colliding. */}
      <div className="flex flex-col items-center justify-center px-6 py-12 md:dark:border-l md:dark:border-border/60">
        <div className="w-full max-w-sm text-center">
          {/* The real logo mark, not a blue text wordmark — the wordmark competed with the
              form's single blue CTA, and the mark is what the header/footer already use. */}
          <Link href="/" className="mb-8 inline-block md:hidden">
            <img src="/logo-mark.svg" alt={SITE_NAME} width={48} height={48} className="h-12 w-12" />
          </Link>
          <h2 className="text-2xl font-bold text-foreground">{tr('Welcome to eno.vn', 'Chào mừng đến eno.vn')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tr('Sign in or create your account in seconds.', 'Đăng nhập hoặc tạo tài khoản trong vài giây.')}</p>
          <SignInForm className="mt-8 text-left" />
          {/* Mobile counterpart of the desktop panel's trust bullets: the navy column (and its
              washed seal) never renders under md, which left the highest-traffic sign-in surface
              with zero trust iconography — inverted priority in a mobile-first market (R2 critic).
              ONE inline seal at the §0b ladder's inline form (14–16 → wash) + one line of copy;
              more would be noise beside the form's single CTA. */}
          <p className="mt-6 flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground md:hidden">
            <EnoSeal variant="wash" className="h-4 w-4 shrink-0" />
            {tr('Trusted sellers · your number stays private', 'Người bán uy tín · số của bạn được giữ kín')}
          </p>
          <Link href="/" className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-accent-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden /> {tr('Back to eno.vn', 'Về trang chủ')}
          </Link>
          {/* Operator identity — the split layout has no Footer, and Đ.36 wants the
              operator identifiable on every public page. Compact single block, seated
              behind a hairline so it reads as the page's quiet legal footer. */}
          <p className="mt-8 border-t border-border/60 pt-4 text-3xs leading-relaxed text-ink-4">
            {COMPANY.name} · {COMPANY.address} · {tr('Business reg. no.', 'GCN ĐKDN số')}: {COMPANY.erc} · {COMPANY.email}
          </p>
        </div>
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
