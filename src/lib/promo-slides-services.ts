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
 * ⚠️ MOCK COPY, DELIBERATELY. Owner, 2026-08-17: "eno.forum will get 1 new banner for its visa and
 * booking services mock until i change it later". It is honest about what the desk does and makes
 * no claim about price or speed — a placeholder that overpromises is worse than no banner, because
 * the visa tiers have real processing times and a real submission gate behind them.
 */
export const SERVICES_PROMO_SLIDES: PromoSlide[] = [
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
    /**
     * ⚠️ THE SAME MOCK ARTWORK THE OTHER SLIDES USE, not a services-specific file. `image` is
     * required by the type and is DECORATIVE ONLY — no text is baked into it — so reusing the
     * existing SVG keeps this slide a placeholder in the way the owner asked for, with `surface`
     * underneath as the floor if it 404s or is still loading. Swap the file when real art arrives;
     * no code changes.
     */
    image: '/banners/promo-1.svg',
    surface: 'bg-gradient-to-br from-brand-deeper via-brand to-accent',
  },
]
