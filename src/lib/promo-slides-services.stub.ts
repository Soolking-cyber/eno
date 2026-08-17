import type { PromoSlide } from '@/lib/promo-slides'

/**
 * THE MARKETPLACE'S COPY OF eno.forum's HOME BANNER: empty, on purpose.
 *
 * ⛔ next.config.ts aliases `@/lib/promo-slides-services` to this file on the marketplace build, so
 * the visa/booking words in the real module never enter eno.vn's bundle. A render-time gate would
 * not be enough — a gate decides what RENDERS, an alias decides what SHIPS, and "the code is not in
 * the artifact" is a claim you can verify with grep while "the code declines to run" is a promise
 * about control flow.
 *
 * ⚠️ It must keep the real module's EXPORT NAME and TYPE. A stub that drifts from its original is a
 * build error on the edition nobody is currently looking at.
 */
export const SERVICES_PROMO_SLIDES: PromoSlide[] = []
