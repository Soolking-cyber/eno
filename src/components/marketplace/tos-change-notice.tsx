'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Bilingual } from '@/components/marketplace/bilingual'
import { useLanguage } from '@/context/language-context'
import { AMENDED, LEGAL_AMENDMENT } from '@/lib/compliance/legal-amendment'
import { tosInNoticeWindow } from '@/lib/site-legal'

/**
 * The on-platform announcement of a Terms / Quy chế amendment, shown on every page during its notice
 * window — [LEGAL_AMENDMENT.published, LEGAL_AMENDMENT.inForce) in Vietnam time.
 *
 * ⛔ NOT MOUNTED SINCE 2026-10-01. The October 2026 amendment was made IMMEDIATE (owner: "just change now
 * we dont have users so its safe to implement just new terms no need for announcement") — in force the
 * day it was published, no window, nothing to announce — so providers.tsx no longer renders it. Kept for
 * the next amendment with a window, which mounts it again in providers.tsx (after SkipLink);
 * legal-amendment.test.ts fails until the mount matches the flag. ⚠️ ONE PART IS THAT AMENDMENT'S: the
 * list of amended texts in the sentence below — rewrite it for each amendment (with the bell copy in
 * legal-amendment-notice.ts, which must stay word for word the same).
 *
 * ⚠️ IT EXISTS BECAUSE PUBLISHING THE NEW TEXTS IS NOT ANNOUNCING THEM. Quy chế Article 15 and the
 * Terms' "Changes" section promise that a material change is announced on the platform at least 5
 * days before it takes effect. Updating /terms and /regulations satisfies "published" and reaches
 * nobody — an existing user does not open the terms page unprompted — so the announcement goes to
 * them (recovered from d067d756, where an external review made the same point).
 *
 * It removes itself: {@link tosInNoticeWindow} turns false at midnight Vietnam time on
 * LEGAL_AMENDMENT.inForce, so there is no flag to remember to flip.
 *
 * ⛔ A CLIENT COMPONENT, AND THAT IS THE WHOLE POINT — DO NOT "OPTIMISE" IT INTO A SERVER ONE.
 * Its visibility depends on the CLOCK, and it renders on every page, including every statically
 * prerendered and ISR one. A server render would bake "show" into on-disk HTML and keep serving it
 * after the window closed (or bake "hide" from a build made before it opened). Deciding after mount
 * also keeps server and client markup identical — nothing renders on the server — so there is no
 * hydration mismatch; the strip appears on the first client paint. The sibling PrelaunchNotice is a
 * server component, correctly, because PRELAUNCH_BANNER is a build-time constant: the difference is
 * the clock, not the styling.
 *
 * ⚠️ BOTH EDITIONS, ON PURPOSE. The amended Terms sections, the Quy chế articles, /returns and
 * /prohibited all render on eno.forum too, so its users are owed the same notice. The copy names
 * no service, so nothing here leaks across the edition boundary.
 *
 * ⚠️ NOT ON /messages. The chat layout sizes itself to the viewport minus a measured
 * `--banner-h` (messages/layout.tsx), which only knows #prelaunch-banner; an unmeasured strip above
 * it would push the composer below the fold. The notice is on every other page.
 *
 * ⚠️ AND IT MOVES THE HEADER, WHICH ONE `fixed` SURFACE USED TO ASSUME IT COULD NOT (2026-10-01 review).
 * At scroll-top the sticky header starts below this strip, not at y=0. The phone search window
 * (header.tsx) was `fixed` at the constant y=60, so it opened over the header's own search field; it now
 * hangs from the header's measured bottom edge (`--search-panel-top`, header.tsx's headerRef effect).
 * Anything else `fixed` that is placed relative to the header must measure it the same way — never
 * assume y=0 while a strip can sit above it. (The offline banner avoids the question by anchoring to
 * the bottom: query-provider.tsx.)
 *
 * ⚠️ IN FLOW, ABOVE THE HEADER, CLEARING THE SAFE AREA ITSELF. In the installed PWA and the native
 * shell the page is edge-to-edge, so the strip pads by env(safe-area-inset-top) or its text sits
 * under the camera pill. The header keeps its own inset too (the .page-at-top coupling in
 * globals.css is keyed to #prelaunch-banner), which costs a double gap at scroll-top on those
 * targets only, for the six days of the window — a cosmetic cost, chosen over re-plumbing that
 * coupling. env() is 0 in a normal browser, where none of this applies.
 */
export function TosChangeNotice() {
  const { lang } = useLanguage()
  const pathname = usePathname()
  const [show, setShow] = useState(false)
  // Re-read the clock on every navigation, not just on mount: the providers persist across client
  // navigations, so a tab left open over the in-force instant would otherwise keep the strip.
  useEffect(() => { setShow(tosInNoticeWindow()) }, [pathname])
  if (!show || pathname?.startsWith('/messages')) return null

  // Literal `tr(en, vi)` calls so gen-ui-strings harvests the English for the nine machine-translated
  // languages, rendered through <Bilingual> so `{date}` is filled after translation.
  const tr = (en: string, vi: string, values?: Record<string, string>, datesIso?: Record<string, string>) => <Bilingual en={en} vi={vi} values={values} datesIso={datesIso} />
  // en and vi print the legal forms; inside a translated line the nine machine-translated languages get
  // their own month name (<Bilingual datesIso>) — the English "1 October 2026" was the one untranslated
  // word in this banner for them, and an English line keeps the English date.
  const date = lang === 'vi' ? AMENDED.inForceVi : AMENDED.inForceEn

  // ⚠️ REWRITE THE DOCUMENT LIST FOR EACH AMENDMENT: "Terms of Service, Operating Regulations, Returns
  // policy and Prohibited items list" are the texts the October 2026 one changed. Change the bell copy
  // (AMENDMENT_NOTICE, legal-amendment-notice.ts) in the same edit — its test holds the two word for word.

  return (
    <div
      id="tos-change-notice"
      role="status"
      className="border-b border-border bg-muted px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-center text-xs leading-snug text-foreground"
    >
      {tr(
        'Our Terms of Service, Operating Regulations, Returns policy and Prohibited items list have been amended. The changes take effect on {date}.',
        'Điều khoản dịch vụ, Quy chế hoạt động, Chính sách đổi trả và Danh mục hàng hoá, dịch vụ cấm đăng đã được sửa đổi. Nội dung sửa đổi có hiệu lực từ ngày {date}.',
        { date },
        { date: LEGAL_AMENDMENT.inForce },
      )}{' '}
      <Link href="/regulations#changelog" className="font-semibold underline underline-offset-2">
        {tr('See what changed', 'Xem nội dung sửa đổi')}
      </Link>
    </div>
  )
}
