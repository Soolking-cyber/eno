import type { LucideIcon } from 'lucide-react'
import { BadgeCheck, Coins, Megaphone } from 'lucide-react'

/**
 * THE HOME BANNER'S CONTENT, AS DATA — so copy can be iterated in one file rather than in JSX.
 *
 * ⚠️ EVERY STRING HERE SHIPS TO BOTH EDITIONS, AND THAT IS THE POINT. eno.vn is the licensed sàn
 * TMĐT and may not mention the services-edition products ANYWHERE; a gate at the call site would
 * not save us, because a gate decides what RENDERS and only a bundler alias decides what SHIPS (the
 * reasoning, and the 61KB chunk that proved it, are in next.config.ts's resolveAlias block).
 * Keeping this file free of services vocabulary means there is nothing to alias and nothing to leak.
 *
 * ⚠️ THIS COMMENT DELIBERATELY DOES NOT SPELL THE FORBIDDEN PRODUCT NAMES. Minification strips
 * comments, so they would not actually reach a browser — but a file whose entire job is to be
 * leak-proof should not be the one place a grep of `src/**` finds them. Keep it that way.
 *
 * ⚠️ SO IF A SERVICES-EDITION SLIDE IS EVER WANTED ON eno.forum, IT DOES NOT GO IN THIS FILE. It needs
 * its own module, an entry in SERVICES_SOURCES in scripts/gen-ui-strings.mjs (which classifies copy
 * by FILE PATH — services strings sitting at a shared path get harvested into ui-strings.ts, the
 * catalogue eno.vn ships to every browser), and a resolveAlias stub in next.config.ts. All three,
 * then proven by grepping .next/static — never by reading the code. cross-site-promo.tsx is the
 * worked example.
 *
 * ⚠️ NOTHING HERE MAY ADVERTISE A CAPABILITY THE PRODUCT DOES NOT HAVE. There are no vouchers, no
 * flash sales, no free shipping and no escrow, and the owner's UX plan says there never will be. A
 * "MEGA SALE" slide would also sit directly under the PRELAUNCH bar that says, in two languages,
 * that the site is not officially operating yet — so slides promote what eno actually does.
 */
export type PromoSlide = {
  key: string
  /** Small label above the headline. Kept to ~2 words: it is the widest line at the smallest size. */
  eyebrowEn: string
  eyebrowVi: string
  titleEn: string
  titleVi: string
  bodyEn: string
  bodyVi: string
  ctaEn: string
  ctaVi: string
  href: string
  icon: LucideIcon
  /**
   * Mock banner artwork, drawn as a CSS background-image over `surface`.
   *
   * ⚠️ DECORATIVE ONLY — THE TEXT IS NEVER BAKED INTO IT. The headline, body and CTA stay real DOM
   * nodes on top, because every string in this app switches EN/VI at runtime and a baked image is
   * permanently monolingual. That also means real artwork can replace these files later with no
   * code change at all: swap the file, keep the copy.
   *
   * ⚠️ AND `surface` STAYS UNDERNEATH AS THE FLOOR. If the image 404s or is still loading, the panel
   * is a finished gradient rather than a white hole above the fold.
   */
  image: string
  /**
   * The panel's fill. ⚠️ TOKENS ONLY — design-lint fails the build on a raw hex, and only
   * `brand-deep`/`brand-deeper` are sanctioned by the canon for "fixed dark marketing panels"
   * (docs/design-language.md §3). They are declared once rather than per-theme, so they do NOT flip
   * in dark mode and white text stays legible in both — which is why no dark: variant appears here.
   */
  surface: string
  /**
   * OPTIONAL full-bleed partner artwork with the message BAKED INTO THE IMAGE.
   *
   * ⚠️ THIS IS THE EXCEPTION TO THE RULE DIRECTLY ABOVE, and it costs something real: a baked
   * image is permanently monolingual, so a Vietnamese visitor sees English on this slide. That is
   * accepted only because the artwork is a PARTNER'S BRAND ASSET — their lockup, their typography,
   * their CTA — and redrawing it as DOM text would misrepresent their brand. Do not use `art` for
   * eno's own slides; those keep real DOM copy so they translate.
   *
   * When present, the panel renders the image INSTEAD of `surface` + headline + body + CTA, since
   * all of that is already in the picture. `alt` therefore has to carry the whole message, because
   * it is the only thing a screen reader gets.
   *
   * Two files, not one: the desktop art is 1280x300 (4.27:1) and the mobile 366x188 (1.95:1) —
   * cropping one to serve both would cut the lockup or the CTA off. They are switched by a
   * `<source media>` so the browser downloads exactly one.
   *
   * ⚠️ WEBP, NOT THE SUPPLIED PNGs. The partner sent PNGs at 495KB (desktop) and 85KB (mobile);
   * re-encoded at quality 86 they are 60KB and 18KB — an 88% cut on the file that IS the home
   * page's LCP element. Shipping the PNG would have made the thing we just told the browser to
   * prioritise the heaviest asset on the page. webp is not a new dependency: every listing photo
   * already serves as webp through the image pipeline.
   */
  art?: { mobile: string; desktop: string; alt: string; altVi: string }
}

/**
 * Order is deliberate: the first slide is the only one most visitors will ever see, so it carries
 * the action the marketplace most needs from a new arrival (supply — an empty marketplace has
 * nothing to browse), not the one that flatters the product most.
 */
export const PROMO_SLIDES: PromoSlide[] = [
  {
    // ⚠️ FIRST SLIDE = THE PARTNER, BY OWNER DECISION (2026-08-10). This displaces the supply-side
    // "post free" slide from the one position most visitors ever see. The reasoning above about
    // supply still holds for eno's own slides — it was overridden here deliberately, not forgotten.
    // Visa content on eno.vn is sanctioned as of that date; see src/app/vietkite/page.tsx for the
    // basis and the limits.
    key: 'vietkite-evisa',
    // The eyebrow/title/body/cta below are NOT RENDERED for an `art` slide — the artwork carries
    // them. They stay populated so that removing `art` (or supplying localised artwork later)
    // restores a working bilingual slide with no migration.
    eyebrowEn: 'Travel & Visa', eyebrowVi: 'Du lịch & Thị thực',
    titleEn: 'Vietnam E-Visa, Your Way', titleVi: 'Thị thực điện tử Việt Nam, theo cách của bạn',
    bodyEn: 'Single and multiple entry options, handled by our licensed partner VietKite.',
    bodyVi: 'Lựa chọn nhập cảnh một lần hoặc nhiều lần, do đối tác được cấp phép VietKite thực hiện.',
    ctaEn: 'View e-visa options', ctaVi: 'Xem các lựa chọn thị thực',
    // Internal: the partner's company page, which carries the licence facts and the
    // "eno is not the provider" sentence. Never link a marketing banner straight at a checkout.
    href: '/vietkite',
    icon: BadgeCheck,
    image: '/banners/promo-1.svg',
    surface: 'bg-brand-deep',
    art: {
      mobile: '/banners/vietkite-mobile.webp',
      desktop: '/banners/vietkite-desktop.webp',
      // Alt carries the WHOLE message because it replaces baked-in text, not decoration.
      alt: 'VietKite — Vietnam E-Visa, your way. Single and multiple entry options. View e-visa options.',
      altVi: 'VietKite — Thị thực điện tử Việt Nam. Lựa chọn nhập cảnh một lần hoặc nhiều lần. Xem các lựa chọn thị thực.',
    },
  },
  {
    key: 'post-free',
    image: '/banners/promo-1.svg',
    eyebrowEn: 'Free to post',
    eyebrowVi: 'Đăng tin miễn phí',
    titleEn: 'Sell it in 60 seconds',
    titleVi: 'Bán trong 60 giây',
    bodyEn: 'Photos, a price, done. No listing fee, no commission, no paid bumps.',
    bodyVi: 'Vài tấm ảnh, một mức giá là xong. Không phí đăng tin, không hoa hồng, không trả tiền đẩy tin.',
    ctaEn: 'Post an ad',
    ctaVi: 'Đăng tin ngay',
    href: '/post',
    icon: Megaphone,
    surface: 'bg-gradient-to-br from-brand-deep to-brand-deeper',
  },
  {
    key: 'trust',
    image: '/banners/promo-2.svg',
    eyebrowEn: 'Know who you deal with',
    eyebrowVi: 'Biết rõ người bán',
    titleEn: 'Every seller has a trust score',
    titleVi: 'Mỗi người bán đều có điểm tin cậy',
    bodyEn: 'Built from real trades and resolved reports — not from stars anyone can buy.',
    bodyVi: 'Dựa trên giao dịch thật và báo cáo đã xử lý — không phải sao đánh giá ai cũng mua được.',
    ctaEn: 'How trust works',
    ctaVi: 'Cách tính điểm tin cậy',
    href: '/trust',
    icon: BadgeCheck,
    surface: 'bg-gradient-to-br from-brand to-brand-deep',
  },
  {
    key: 'dual-currency',
    image: '/banners/promo-3.svg',
    eyebrowEn: 'Made for expats',
    eyebrowVi: 'Dành cho người nước ngoài',
    titleEn: 'Prices in VND and $, side by side',
    titleVi: 'Giá hiển thị cả đ và $',
    bodyEn: 'Every listing shows both, so you always know what you are actually paying.',
    bodyVi: 'Mọi tin đăng đều hiện cả hai, để bạn luôn biết mình thực sự trả bao nhiêu.',
    ctaEn: 'Browse listings',
    ctaVi: 'Xem tin đăng',
    href: '/?sort=newest',
    icon: Coins,
    surface: 'bg-gradient-to-br from-brand-deeper via-brand-deep to-brand',
  },
]
