import type { LucideIcon } from 'lucide-react'
import { BadgeCheck, Coins, Megaphone, ShieldCheck, Sparkles } from 'lucide-react'

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
   * The panel's fill. ⚠️ TOKENS ONLY — design-lint fails the build on a raw hex, and only
   * `brand-deep`/`brand-deeper` are sanctioned by the canon for "fixed dark marketing panels"
   * (docs/design-language.md §3). They are declared once rather than per-theme, so they do NOT flip
   * in dark mode and white text stays legible in both — which is why no dark: variant appears here.
   */
  surface: string
}

/**
 * Order is deliberate: the first slide is the only one most visitors will ever see, so it carries
 * the action the marketplace most needs from a new arrival (supply — an empty marketplace has
 * nothing to browse), not the one that flatters the product most.
 */
export const PROMO_SLIDES: PromoSlide[] = [
  {
    key: 'post-free',
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

/**
 * The two static tiles beside the carousel on desktop, and the tail slides on a phone.
 *
 * ⚠️ THEY MUST GO SOMEWHERE REAL. A promo tile with nowhere useful to land is worse than no tile —
 * the reviewer question that produced this note was "what do those two actually link to, given
 * there are no campaigns?". Both destinations below are live routes carrying real content, chosen
 * because they answer the two questions a new arrival in Vietnam actually has.
 */
export type PromoTile = {
  key: string
  titleEn: string
  titleVi: string
  bodyEn: string
  bodyVi: string
  href: string
  icon: LucideIcon
  surface: string
}

export const PROMO_TILES: PromoTile[] = [
  {
    key: 'safety',
    titleEn: 'Trade safely',
    titleVi: 'Giao dịch an toàn',
    bodyEn: 'Meet, inspect, then pay. Never send a deposit through a link.',
    bodyVi: 'Gặp mặt, kiểm tra rồi mới trả tiền. Đừng bao giờ đặt cọc qua đường link.',
    href: '/safety',
    icon: ShieldCheck,
    surface: 'bg-gradient-to-br from-brand-deep to-brand-deeper',
  },
  {
    key: 'motorbikes',
    titleEn: 'Motorbikes',
    titleVi: 'Xe máy',
    bodyEn: 'The first thing most people buy here.',
    bodyVi: 'Thứ đầu tiên hầu hết mọi người mua ở đây.',
    href: '/?category=vehicles',
    icon: Sparkles,
    surface: 'bg-gradient-to-br from-brand to-brand-deep',
  },
]
