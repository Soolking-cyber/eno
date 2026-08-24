import { VINWONDERS_SLIDE } from '@/lib/promo-slides'
import type { PromoSlide } from '@/lib/promo-slides'
import { Plane } from '@/components/ui/icons'

/**
 * eno.forum'S HOME BANNER — its own file, because it is the one place services vocabulary is allowed.
 *
 * ⛔ THIS DOES NOT GO IN `promo-slides.ts`, AND THAT FILE SAYS SO IN ITS OWN HEADER. Every string
 * there ships to BOTH editions, so a services slide added to it would put visa and booking words
 * into the licensed marketplace's bundle — and a gate at the render site would not save it, because
 * a gate decides what RENDERS and only a bundler alias decides what SHIPS. That file's job is to be
 * leak-proof; this one's job is to be the exception, in a place the alias can reach.
 *
 * The three parts that make that true, all of which must exist or this leaks:
 *   1. this module, at a path nothing shared imports;
 *   2. `SERVICES_SOURCES` in scripts/gen-ui-strings.mjs — that classifier works on FILE PATH, so
 *      without an entry these strings are harvested into ui-strings.ts, the catalogue eno.vn ships
 *      to every browser and pays to machine-translate;
 *   3. a `resolveAlias` stub in next.config.ts pointing the marketplace build at the empty sibling.
 * ⚠️ Prove it by grepping `.next/static` after a marketplace build, never by reading the code —
 * that is the house rule for this class of change and it exists because reading has been wrong.
 *
 * ✅ NO LONGER A MOCK. Owner supplied the real artwork on 2026-08-18 ("add the banners to eno.forum
 * optimize sharpen and add as only banner"), so this is an `art` slide now — the message is BAKED
 * INTO the image, exactly like the VietKite and GMBR slides on eno.vn.
 *
 * ⛔ AN `art` SLIDE PUTS THE WHOLE MESSAGE IN `alt`, AND THAT IS NOT A FORMALITY. The DOM copy
 * below stops rendering the moment `art` exists, so `alt` is the ONLY thing a screen reader, a
 * crawler, or anyone on a failed image request receives. It therefore carries every line of the
 * artwork — headline, the three supporting claims, and the call to action — rather than describing
 * the picture.
 *
 * ⚠️ AND IT CARRIES NO `partner` FIELD, UNLIKE ITS TWO SIBLINGS. That property renders a
 * "Quảng cáo · <partner>" advertising disclosure, which is correct for VietKite and GMBR because
 * those are third-party ads. This is eno's own service on eno's own site: labelling it as an
 * advertisement would be a false disclosure, not a cautious one.
 */
export const SERVICES_PROMO_SLIDES: PromoSlide[] = [
  /**
   * ⛔ THE SAME OBJECT eno.vn SHOWS, IMPORTED RATHER THAN COPIED. VinWonders is the one storefront
   * both editions carry (owner, 2026-08-24), so a second literal here would drift the first time
   * the artwork or the link changed on one side only. Everything else in this array is eno's own
   * desk, which is exactly what eno.vn must NOT promote — that separation is unchanged.
   */
  VINWONDERS_SLIDE,
  {
    key: 'eno-services',
    eyebrowEn: 'eno.forum',
    eyebrowVi: 'eno.forum',
    titleEn: 'Visas and trips, arranged in chat',
    titleVi: 'Thị thực và chuyến đi, sắp xếp ngay trong tin nhắn',
    bodyEn: 'Tell us what you need and a real person handles it — no forms to guess at, no account to make first.',
    bodyVi: 'Cho chúng tôi biết bạn cần gì và một người thật sẽ lo phần còn lại — không biểu mẫu khó hiểu, không cần tạo tài khoản trước.',
    ctaEn: 'See what we do',
    ctaVi: 'Xem dịch vụ',
    href: '/vietnam-evisa',
    icon: Plane,
    // `image` stays required by the type and is the decorative floor behind the art; `surface` is
    // the colour underneath both, so a slow or failed image request shows brand blue rather than a
    // hole. Neither is what a reader sees once `art` loads.
    image: '/banners/promo-1.svg',
    surface: 'bg-brand-deep',
    art: {
      /**
       * ⚠️ THE MOBILE FILE IS A 2x UPSCALE OF A 1x SOURCE, and the reasoning is the GMBR slide's,
       * measured again here: the supplied mobile export is 366x188, so shipping it as-is would be
       * soft on every retina phone. It is resampled to 732x376 (lanczos3 + a MILD unsharp mask,
       * sigma 0.6 / m1 0.8) by scripts/banner-optimize.mjs. A stronger sharpen haloes the wordmark
       * edge — this artwork is flat brand shapes and type, which is the worst case for over-
       * sharpening. Upscaling adds no real detail: a genuine 732x376 export from the designer is
       * still better, and swapping the file needs no code change.
       *
       * ⚠️ THE DESKTOP ART IS NATIVE 1280x300 AND STAYS 1x. It is the home page's LCP image; a 2x
       * desktop would roughly triple the weight of the one image on the site that must not get
       * heavier.
       */
      mobile: '/banners/evisa-mobile.webp',
      desktop: '/banners/evisa-desktop.webp',
      // avif first, webp as the fallback: 33,906 -> 15,630 B desktop and 27,892 -> 13,362 B mobile.
      avif: { mobile: '/banners/evisa-mobile.avif', desktop: '/banners/evisa-desktop.avif' },
      /**
       * ⛔ `null`, NOT A MISSING KEY. The field is required-but-nullable (see promo-slides.ts): the
       * compiler forces every art slide to state whose message it carries, and `null` is the
       * explicit answer "eno's own". Writing a partner name here would publish a false advertising
       * disclosure about eno's own service on eno's own site.
       */
      partner: null,
      alt: 'Vietnam e-Visa, made simple. Clear pricing, reliable processing and real support. Apply now.',
      altVi: 'e-Visa Việt Nam, thật đơn giản. Giá rõ ràng, xử lý đáng tin cậy và hỗ trợ thật sự. Nộp hồ sơ ngay.',
    },
  },
]
