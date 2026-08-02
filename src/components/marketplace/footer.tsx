'use client'

import { Facebook, Instagram, Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { FORUM_URL, goToForum } from '@/lib/forum-nav'
import { handleExternalClick } from '@/lib/native-browser'
import { COMPANY } from '@/lib/site-legal'
import { TAXONOMY } from '@/lib/taxonomy'
import { SERVICES_FOOTER_GROUPS, SERVICES_FOOTER_LINKS } from '@/lib/edition-services-copy'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'

/**
 * One footer entry.
 *
 * ⚠️ TYPED EXPLICITLY RATHER THAN INFERRED, because inference across a heterogeneous array is what
 * broke here: with three shapes of link object in `columns` (plain, +forumPath, +rel), TypeScript
 * widened the optional properties to `unknown`, so `link.rel` failed to typecheck even behind an
 * `'rel' in link` guard. One named type makes every optional property readable directly and keeps
 * the render below free of narrowing tricks.
 */
type FooterLink = {
  label: string
  href: string
  /** Cross-site links only — `noopener`, never nofollow. See src/lib/cross-site-links.ts. */
  rel?: string
  /** eno.forum links only — routes the click through goToForum()'s single-use SSO handoff. */
  forumPath?: string
}

export function Footer() {
  const { tr } = useLanguage()

  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: tr('Customer service', 'Chăm sóc khách hàng'),
      links: [
        { label: tr('Help center', 'Trung tâm trợ giúp'), href: '/help' },
        { label: tr('Safe trading', 'An toàn giao dịch'), href: '/safety' },
        { label: tr('Contact us', 'Liên hệ'), href: 'mailto:support@eno.vn' },
      ],
    },
    {
      title: tr('About eno.vn', 'Về eno.vn'),
      links: [
        { label: tr('About us', 'Giới thiệu'), href: '/about' },
        { label: tr('How it works', 'Cách hoạt động'), href: '/guide' },
        { label: tr('How trust works', 'Điểm uy tín hoạt động thế nào'), href: '/trust' },
        { label: tr('Operating regulations', 'Quy chế hoạt động'), href: '/regulations' },
        { label: tr('Prohibited items', 'Hàng hóa & dịch vụ cấm'), href: '/prohibited' },
      ],
    },
    {
      title: tr('Shortcuts', 'Lối tắt'),
      links: [
        { label: tr('Post a listing', 'Đăng tin'), href: '/post' },
        { label: tr('Saved listings', 'Tin đã lưu'), href: '/saved' },
        { label: tr('Map', 'Bản đồ'), href: '/?view=map' },
        { label: tr('Browse by brand', 'Duyệt theo thương hiệu'), href: '/brands' },
      ],
    },
    {
      title: tr('Popular searches', 'Tìm kiếm phổ biến'),
      links: [
        { label: tr('Housing in Vietnam for expats', 'Nhà ở cho người nước ngoài tại Việt Nam'), href: '/housing-vietnam-expats' },
        { label: tr('Jobs in Vietnam for expats', 'Việc làm cho người nước ngoài'), href: '/jobs-vietnam-expats' },
        { label: tr('Motorbikes for sale in Vietnam', 'Mua bán xe máy tại Việt Nam'), href: '/motorbikes-for-sale-vietnam' },
        { label: tr('Moving sales in Vietnam', 'Thanh lý chuyển nhà tại Việt Nam'), href: '/moving-sales-vietnam' },
        /* ⚠️ SERVICES EDITION ONLY. eno.vn is a licensed sàn TMĐT and may not advertise visa,
           itinerary or PayPal services. The footer is the highest-frequency leak in the repo:
           these are real crawlable <a href> anchors on ~250 routes in BOTH languages, baked
           into every prerendered file down to _not-found.html. `IS_SERVICES` is a build-time
           constant, so on a marketplace build the minifier deletes the entry outright rather
           than rendering nothing. */
        ...SERVICES_FOOTER_LINKS.popular.slice(0, 1).map((l) => ({ label: tr(l.labelEn, l.labelVi), href: l.href })),
        // ⚠️ THE WHOLE SEO HALF OF THE FIX, IN ONE LINE. `grep -rn "vietnam-evisa" src` returned
        // exactly ONE inbound internal link — from /services-for-expats-vietnam, which is itself
        // only reachable from this same column. So the 6-page e-Visa cluster sat TWO footer hops
        // from anywhere, on a site Googlebot visited 15 times in two days. This puts it one hop
        // from every page. A real <a href>, unlike the home tiles, which are Buttons.
        ...SERVICES_FOOTER_LINKS.popular.slice(1).map((l) => ({ label: tr(l.labelEn, l.labelVi), href: l.href })),
      ],
    },
    {
      title: tr('Community', 'Cộng đồng'),
      // ⚠️ Any link here that LEAVES the origin MUST carry forumPath so the click is
      // intercepted by goToForum() below — a plain cross-origin anchor drops the
      // native app on eno.forum as a GUEST (sessions are per-origin cookies; the
      // forum mints its own only via the /auth/bridge handoff). That was a live bug
      // here: every dashboard forum CTA already routed through goToForum, and only
      // the footer still handed users a raw URL.
      links: [
        { label: tr('Community forum', 'Diễn đàn cộng đồng'), href: `${FORUM_URL}/`, forumPath: '/' },
        // Trip planner is SAME-ORIGIN now (owner, 2026-07-25): the itinerary service moved to
        // eno.vn and /itinerary is a real page here, not a redirect off to the forum. So it
        // must NOT carry forumPath — routing a same-origin link through the SSO handoff would
        // bounce the visitor to eno.forum and back to fetch a session they already have.
        ...SERVICES_FOOTER_LINKS.explore.map((l) => ({ label: tr(l.labelEn, l.labelVi), href: l.href })),
        // e-Visa lives on eno.vn now (ownership row, 2026-07-21): the desk's storefront is
        // where a visitor applies (in-chat flow) — the forum wizard is legacy awaiting
        // retirement. Plain SAME-ORIGIN link: no forumPath, no goToForum interception.
        // ⚠️ THE HANDLE IS `eno_visa`, AND `/eno_vietnam` 404s. It had done so sitewide — this is
        // the footer, so every page carried a dead link to the one product that takes money, and
        // both homepage links pointed at it too. Found 2026-07-27 auditing why the site does not
        // rank; the storefront holds 14 of the 34 live listings and nothing reachable pointed at it.
        // `/eno_vietnam` is 301'd in next.config.ts rather than simply dropped, because Bing has it
        // indexed under the title "Eno Visa" — deleting it would strip a real inbound path.
        ...SERVICES_FOOTER_LINKS.help.map((l) => ({ label: tr(l.labelEn, l.labelVi), href: l.href })),
      ],
    },
    /**
     * ⚠️ A WHOLE COLUMN, SERVICES EDITION ONLY, AND IT POINTS OFF-ORIGIN. This is the "On eno.vn"
     * group: absolute, dofollow links from every page of eno.forum to the marketplace's keyword
     * landing pages. On a marketplace build SERVICES_FOOTER_GROUPS is `[]` (the stub), so the
     * column does not exist at all rather than rendering empty — and, more to the point, its labels
     * are not in the artifact. See src/lib/cross-site-links.ts.
     *
     * ⚠️ NO `forumPath`, DELIBERATELY. That property routes a click through goToForum()'s
     * single-use SSO handoff, which exists so the NATIVE app arrives on eno.forum signed in. These
     * links go the other way, to eno.vn, which is first-party to the shell (native-browser.ts's
     * FIRST_PARTY_HOSTS) — the WebView is allowed to navigate there directly. Adding forumPath here
     * would send a reader who tapped "Housing in Vietnam" to the forum's auth bridge instead.
     */
    ...SERVICES_FOOTER_GROUPS.map((g) => ({
      title: tr(g.titleEn, g.titleVi),
      links: g.links.map((l) => ({ label: tr(l.labelEn, l.labelVi), href: l.href, rel: l.rel })),
    })),
  ]

  return (
    <footer id="app-footer" className="mt-auto pt-8 pb-8 text-muted-foreground">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8">
        {/* Blends into the page canvas (no bg-card). The divider is on the GRID, so it spans the
            CONTENT width inset by the gutter — a contained hairline, NOT the full-viewport edge. */}
        <div className="grid grid-cols-2 gap-8 border-t border-border/60 pt-12 md:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1 space-y-3">
            {/* alt + tagline are PER-EDITION. Both said "eno.vn" unconditionally, so eno.forum's
                footer introduced itself as the licensed Vietnamese marketplace — the leak class
                SITE_NAME exists for. The two taglines are spelled out as separate literals rather
                than interpolated, because scripts/gen-ui-strings.mjs harvests `tr("…", "…")` by
                matching string literals and silently skips a template expression: interpolating
                SITE_NAME here would compile, render, and then ship untranslated to every other
                language. */}
            <img src="/logo-mark.svg" alt={SITE_NAME} width={36} height={36} className="h-9 w-9" />
            <p className="max-w-[220px] text-xs leading-relaxed text-muted-foreground">
              {IS_SERVICES
                ? tr("eno.forum — Vietnam's trusted marketplace for the international community.", 'eno.forum — chợ uy tín cho cộng đồng quốc tế tại Việt Nam.')
                : tr("eno.vn — Vietnam's trusted marketplace for the international community.", 'eno.vn — chợ uy tín cho cộng đồng quốc tế tại Việt Nam.')}
            </p>
            {/* The only genuinely OFF-SITE links on the page. In the native shell a plain
                cross-origin anchor is a HARD EXIT — Capacitor hands the URL to Safari/Chrome and
                the user has left eno for another app. handleExternalClick keeps them in an in-app
                browser tab presented over the app instead (no-op on web: href/target/rel below
                still do all the work there, modifier-clicks included). */}
            <div className="flex items-center gap-3 pt-1">
              <a href="https://www.facebook.com/profile.php?id=61591370031264" onClick={handleExternalClick} target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on Facebook" className="text-muted-foreground transition-colors hover:text-accent-foreground"><Facebook className="h-5 w-5" /></a>
              <a href="https://www.instagram.com/eno.vn/" onClick={handleExternalClick} target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on Instagram" className="text-muted-foreground transition-colors hover:text-accent-foreground"><Instagram className="h-5 w-5" /></a>
              <a href="https://www.youtube.com/@enovietnam" onClick={handleExternalClick} target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on YouTube" className="text-muted-foreground transition-colors hover:text-accent-foreground"><Youtube className="h-5 w-5" /></a>
            </div>
          </div>

          {/* Explore — crawlable internal links to every /c/{slug} category landing
              (SEO internal linking). Slugs and bilingual names come straight from the
              canonical taxonomy (src/lib/taxonomy.ts), so this never drifts from it. */}
          <div className="col-span-2 space-y-3">
            <h3 className="text-sm font-bold text-foreground">{tr('Explore', 'Khám phá')}</h3>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
              {TAXONOMY.map((cat) => (
                <li key={cat.slug}>
                  <a href={`/c/${cat.slug}`} className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{tr(cat.name, cat.nameVi)}</a>
                </li>
              ))}
            </ul>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title} className="space-y-3">
              <h3 className="text-sm font-bold text-foreground">{col.title}</h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {/* href stays a REAL url for a11y / middle-click / cmd-click; a plain
                        left-click on a forum link is intercepted so the native app takes
                        the single-use SSO handoff instead of arriving signed out. Every
                        other link gets handleExternalClick, which is a no-op unless the
                        href is genuinely third-party AND we're in the native shell — so
                        the internal routes and the mailto: below behave exactly as before,
                        and a future off-site link here can't silently become a hard exit. */}
                    {/* ⚠️ `rel` IS ONLY EVER `noopener` HERE, NEVER `nofollow`. It is carried on
                        the link object (undefined for every same-origin row) so that the eno.vn
                        column's dofollow decision is made once, in src/lib/cross-site-links.ts,
                        rather than being re-litigated in the footer markup. */}
                    <a
                      href={link.href}
                      rel={link.rel}
                      onClick={link.forumPath
                        ? (e) => {
                            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                            e.preventDefault()
                            goToForum(link.forumPath!)
                          }
                        : handleExternalClick}
                      className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground"
                    >{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Legal identity of the operator — Decree 52/2013 Đ.36/Đ.29 requires the
            company name, address, ERC and contacts displayed on the site. Values
            come from src/lib/site-legal.ts (placeholders until the ERC is issued). */}
        <div className="mt-10 space-y-1 pt-5 text-2xs leading-relaxed text-body">
          <p className="font-semibold text-muted-foreground">{COMPANY.name}</p>
          <p>{tr('Head office', 'Trụ sở')}: {COMPANY.address}</p>
          <p>{tr('Business registration no.', 'GCN ĐKDN số')}: {COMPANY.erc} · {tr('issued', 'cấp')}: {COMPANY.ercIssued}</p>
          <p>{tr('Email', 'Email')}: <a href={`mailto:${COMPANY.email}`} className="transition-colors hover:text-accent-foreground">{COMPANY.email}</a> · {tr('Phone', 'Điện thoại')}: {COMPANY.phone}</p>
          <p className="text-ink-4">{tr('E-commerce platform registration with the Ministry of Industry and Trade: in progress.', 'Đăng ký sàn giao dịch TMĐT với Bộ Công Thương: đang thực hiện.')}</p>
        </div>

        <div className="mt-6 flex flex-col items-center justify-between gap-2 pt-5 text-xs text-body sm:flex-row">
          <p className="flex items-center gap-1.5">
            {/* ⚠️ SITE_NAME, NOT A LITERAL — a copyright line is a claim about WHO OPERATES THIS
                SITE, so eno.forum asserting "© eno.vn" was the licensed marketplace claiming
                ownership of a service it is not licensed to run. It survived the 2026-08-02 wordmark
                sweep because it hid among the eno.vn BACKLINKS the forum carries on purpose ("About
                eno.vn", "Browse the eno.vn marketplace") — those are wanted; this was not. Grepping
                the live forum for "eno.vn" returns ~28 hits and almost all of them are correct,
                which is exactly why this one needed reading rather than counting. */}
            <span>© {new Date().getFullYear()} {SITE_NAME} — {tr('All rights reserved.', 'Mọi quyền được bảo lưu.')}</span>
            <span aria-hidden="true">·</span>
            <span>{tr('Made in Saigon', 'Làm tại Sài Gòn')} <span aria-hidden="true">❤️</span></span>
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href="/terms" className="transition-colors hover:text-accent-foreground">{tr('Terms', 'Điều khoản')}</a>
            <a href="/privacy" className="transition-colors hover:text-accent-foreground">{tr('Privacy', 'Quyền riêng tư')}</a>
            <a href="/regulations" className="transition-colors hover:text-accent-foreground">{tr('Regulations', 'Quy chế')}</a>
            {/* Consent withdrawal entry point — reopens the cookie banner (PDPL). */}
            <Button type="button" variant="bare" size="none" onClick={() => window.dispatchEvent(new CustomEvent('eno:open-consent'))} className="cursor-pointer text-xs font-normal transition-colors hover:text-accent-foreground">{tr('Cookie settings', 'Cài đặt cookie')}</Button>
          </div>
        </div>
      </div>
    </footer>
  )
}
