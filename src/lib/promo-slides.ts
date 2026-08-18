import type { IconComponent } from '@/components/ui/icons'
import { BadgeCheck, Coins, Megaphone, Plane } from '@/components/ui/icons'

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
  icon: IconComponent
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
   *
   * ⚠️ `partner` IS INSIDE THIS OBJECT, NOT BESIDE IT, AND THAT NESTING IS THE WHOLE GUARD. Baked
   * artwork is the only thing on this page that deletes eno's own bilingual copy and puts a third
   * party's paid message above the fold in its place, so the slide has to be able to say WHOSE
   * message it is. Nesting the field makes an undisclosed partner banner a TYPE ERROR — you cannot
   * add `art` without naming the advertiser — where a sibling `partner?:` would be a convention
   * nobody enforces and a lint rule would be no help at all, because scripts/design-lint.mjs only
   * walks .tsx and this is a .ts file. promo-banner.tsx renders it, and src/lib/promo-slides.test.ts
   * covers the two things the type cannot: that the name is not the empty string, and that the alt
   * text names them too (alt is the ONLY thing a screen reader gets from a baked image, and the
   * banner's aria-label DEPENDS on that second assertion — see the note there before deleting it).
   *
   * ⛔ `partner` IS NULLABLE SINCE 2026-08-18, AND IT IS STILL REQUIRED — THAT COMBINATION IS THE
   * POINT. eno.forum now carries baked artwork for eno's OWN e-visa desk, so the old invariant
   * ("artwork exists solely to carry a partner's lockup", below) is no longer true: art no longer
   * implies bought. The naive fix is `partner?: string`, and it would quietly undo the entire guard
   * this comment describes — an author who forgot the field would get a partner banner with no
   * disclosure and no error, which is exactly the failure the nesting was invented to prevent.
   *
   * Required-but-nullable keeps the compiler asking the question. You cannot add `art` without
   * DECIDING whose message it is: a name, or an explicit `null` meaning "this is ours". `null` is
   * greppable and reads as a decision; a missing key reads as an oversight, and only one of those
   * is safe to have in this file.
   *
   * ⚠️ WHAT THIS DOES NOT GUARD, STATED PLAINLY: it ties disclosure to a SHAPE (baked artwork), not
   * to money. A future paid placement written as an ordinary slide — eno's own DOM copy, sold —
   * would carry no `art`, so no `partner`, so no chip, and nothing here would notice. That is
   * acceptable only while `art` and "bought" mean the same thing, which they do today because
   * artwork exists solely to carry a partner's lockup. The day a slide is sold without artwork,
   * this field moves up to PromoSlide and the disclosure stops keying off `art`.
   */
  /**
   * ⚠️ `avif` IS ONE OPTIONAL PAIR, NOT TWO OPTIONAL FIELDS, AND THAT SHAPE IS THE SAFETY.
   * The WebP stays required; the <picture> offers AVIF first and falls back, so a slide with no
   * AVIF cut serves exactly what it always did.
   *
   * ⛔ THE FIRST CUT HAD `avifMobile?` / `avifDesktop?` SEPARATELY AND AN EXTERNAL REVIEWER BROKE
   * IT: the mobile <source> deliberately carries no `media` (it is the catch-all, mirroring the
   * <img> fallback), so a slide with a mobile cut but no desktop one would hand a DESKTOP browser
   * the 732px mobile image — a wrong-size LCP that no gate would catch, on the home page. Making
   * the pair atomic makes that state unrepresentable instead of merely undocumented.
   */
  art?: { mobile: string; desktop: string; avif?: { mobile: string; desktop: string }; alt: string; altVi: string; partner: string | null }
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
      // Measured 2026-08-14: 32,324 -> 18,018 B mobile, 70,222 -> 31,913 B desktop (q50).
      avif: { mobile: '/banners/vietkite-mobile.avif', desktop: '/banners/vietkite-desktop.avif' },
      // The advertiser, rendered on the panel as the "Quảng cáo · VietKite" disclosure chip and
      // spoken FIRST in the link's accessible name. Not a duplicate of the alt string: alt is the
      // artwork's message, this is the attribution, and the two are separated so the disclosure
      // survives any future rewrite of the copy.
      partner: 'VietKite',
      // Alt carries the WHOLE message because it replaces baked-in text, not decoration.
      alt: 'VietKite — Vietnam E-Visa, your way. Single and multiple entry options. View e-visa options.',
      altVi: 'VietKite — Thị thực điện tử Việt Nam. Lựa chọn nhập cảnh một lần hoặc nhiều lần. Xem các lựa chọn thị thực.',
    },
  },
  {
    // The second official partner (owner, 2026-08-13). Same shape as VietKite above: a partner
    // brand asset with the message BAKED IN, so it takes the `art` branch rather than the DOM-copy
    // one, and it carries the same "Quảng cáo · <partner>" disclosure.
    key: 'gmbr-travel',
    // Not rendered for an `art` slide — kept populated so removing `art` (or receiving localised
    // artwork) restores a working bilingual slide with no migration. Same contract as VietKite.
    eyebrowEn: 'Travel booking', eyebrowVi: 'Đặt chỗ du lịch',
    titleEn: 'Everything You Need to Book', titleVi: 'Mọi thứ bạn cần để đặt chỗ',
    bodyEn: 'Flights, hotels, travel insurance and attraction tickets, handled by our partner GMBR.',
    bodyVi: 'Vé máy bay, khách sạn, bảo hiểm du lịch và vé tham quan, do đối tác GMBR thực hiện.',
    ctaEn: 'View booking options', ctaVi: 'Xem các lựa chọn đặt chỗ',
    // ⚠️ THE PARTNER'S STOREFRONT, NOT THEIR CHECKOUT — the same rule the VietKite slide states:
    // never point a marketing banner straight at a purchase. This resolves through the Handle row
    // that scripts/register-partner-seller.mjs creates, so the slide is DEAD until that has been
    // run with --apply. Ship the two together.
    href: '/gmbr',
    icon: Plane,
    image: '/banners/promo-1.svg',
    surface: 'bg-brand-deep',
    art: {
      // ⚠️ THE MOBILE FILE IS AN UPSCALE, AND THAT IS DELIBERATE. GMBR supplied only a 1x
      // 366x188 export where VietKite's is 2x 732x376. Shipping the 1x would have been soft on
      // every retina phone AND — because both slides sit in one carousel — a different intrinsic
      // size from its neighbour. So it is resampled to 732x376 (lanczos3 + a mild unsharp mask,
      // sigma 0.6/m1 0.8, webp q84 -> 44KB against VietKite's 32KB). Compared against the plain
      // resample and a stronger sharpen at 2.6x zoom: mild is crisp, strong haloes the logo edge.
      // Upscaling adds no real detail, so a genuine 732x376 export from the partner is still
      // better — swap the file, no code change. The DESKTOP art is native 1280x300, same as
      // VietKite; a 2x desktop would triple the weight of the home page's LCP image.
      mobile: '/banners/gmbr-mobile.webp',
      desktop: '/banners/gmbr-desktop.webp',
      // 44,388 -> 20,618 B mobile, 87,504 -> 38,323 B desktop (q50).
      avif: { mobile: '/banners/gmbr-mobile.avif', desktop: '/banners/gmbr-desktop.avif' },
      partner: 'GMBR',
      // Alt carries the WHOLE message — it replaces baked-in text, and it is all a screen reader
      // gets. The badges in the artwork ("600+ airlines", "10+ years") are the partner's claims,
      // not eno's, so they stay attributed to GMBR in the sentence rather than stated as fact.
      alt: 'GMBR — everything you need to book. Flights, hotels, travel insurance and attraction tickets. View booking options.',
      altVi: 'GMBR — mọi thứ bạn cần để đặt chỗ. Vé máy bay, khách sạn, bảo hiểm du lịch và vé tham quan. Xem các lựa chọn đặt chỗ.',
    },
  },
  /**
   * ⛔ THREE GENERIC SLIDES WERE REMOVED HERE ON 2026-08-17, and they are not coming back yet.
   * Owner: "eno.vn keeps vietkite gmbr banners remove else".
   *
   * They were `post-free` ("Sell it in 60 seconds"), `trust` and `dual-currency` — house copy
   * promoting the marketplace itself. They stopped being true for the moment the site is in: new
   * sellers and new products are cut off until the Ministry of Industry and Trade registration is
   * issued, so a banner inviting anyone to post an ad advertises a door that is deliberately shut,
   * directly under a PRELAUNCH bar that says the site is not operating yet.
   *
   * ⚠️ RESTORE THEM WITH THE ALLOW-LIST, NOT BEFORE. When `MARKETPLACE_ALLOWED_OWNER_EMAILS` is
   * unset again (see src/lib/edition-scope.ts) the marketplace is open to everyone, and that is the
   * moment "Sell it in 60 seconds" becomes honest copy again. They are in git history at this
   * commit; recover them rather than rewriting them.
   */
]
