import { guideBlurb, guideEntry, guideLabel, guidePath, isGuideLive } from '@/lib/guides/registry'
import { VEHICLE_HUB_SLUGS } from '@/lib/vehicle-hub-slugs'
import type { RelatedLink } from '@/components/marketplace/seo-article-related'
import type { VehicleHubKind } from '@/lib/vehicle-hubs'

/**
 * "KEEP READING" UNDER A VEHICLE-HIRE HUB: the guides about renting that vehicle, then the other hub.
 *
 * ⚠️ IT USED TO BE EVERY MARKETPLACE GUIDE (marketplaceGuidesExcept): the motorbike hub's readers were sent to furniture and
 * second-hand guides, while the motorbike guides Reach wrote (licence, deposits, prices) were linked from nowhere on it. The
 * OpenSEO audit of 2026-11-26 found it ("Keep reading" links furniture guides, not the motorbike guides) on the page whose two
 * searches, thuê xe máy sài gòn and thuê xe máy tphcm, see eno.vn on Google's third page. A link from the hub is also the
 * guide's own best link: the page a renter lands on.
 *
 * Only LIVE guides of the hub's own language (a guide is live from its release day, registry.ts `isGuideLive`), in this
 * order. Six at most, so `keepReading` keeps the author's order (seo-article-related.ts).
 */
const GUIDES_FOR: Record<VehicleHubKind, Record<'en' | 'vi', readonly string[]>> = {
  motorbike: {
    en: ['renting-a-motorbike-in-ho-chi-minh-city', 'renting-a-motorbike-in-vietnam', 'international-driving-permit-vietnam', 'vinfast-electric-scooter-and-car-rental-ho-chi-minh-city'],
    vi: ['thue-xe-may-sai-gon-kinh-nghiem', 'kinh-nghiem-thue-xe-may-viet-nam', 'bang-lai-xe-quoc-te-lai-xe-o-viet-nam', 'thue-xe-dien-vinfast-tphcm'],
  },
  car: {
    en: ['car-rental-with-driver-ho-chi-minh-city', 'international-driving-permit-vietnam', 'vinfast-electric-scooter-and-car-rental-ho-chi-minh-city'],
    vi: ['thue-xe-o-to-tu-lai-hay-co-tai-xe-tphcm', 'bang-lai-xe-quoc-te-lai-xe-o-viet-nam', 'thue-xe-dien-vinfast-tphcm'],
  },
}

/** The other hub's card. Article text in the hub's language: ternaries, never an { en, vi } pair (gen-ui-strings harvests those). */
function siblingHub(kind: VehicleHubKind, lang: 'en' | 'vi'): RelatedLink {
  const vi = lang === 'vi'
  const href = `/${VEHICLE_HUB_SLUGS[kind][lang]}`
  return kind === 'car'
    ? {
        href,
        label: vi ? 'Thuê xe tự lái TP.HCM' : 'Car rental in Ho Chi Minh City',
        blurb: vi ? 'Xe tự lái từ các cửa hàng địa phương, và giá thuê một ngày theo từng loại xe.' : 'Self-drive cars from local shops, and what a day costs by car size.',
      }
    : {
        href,
        label: vi ? 'Thuê xe máy Sài Gòn' : 'Motorbike rental in Ho Chi Minh City',
        blurb: vi ? 'Xe ga và xe số từ các cửa hàng, thuê theo ngày hoặc theo tháng.' : 'Scooters and bikes from local shops, by the day or the month.',
      }
}

export function vehicleHubRelated(kind: VehicleHubKind, lang: 'en' | 'vi', now: Date = new Date()): RelatedLink[] {
  const guides = GUIDES_FOR[kind][lang].flatMap((slug) => {
    const e = guideEntry(slug)
    return e && e.lang === lang && isGuideLive(e, now) ? [{ href: guidePath(e), label: guideLabel(e), blurb: guideBlurb(e) }] : []
  })
  return [...guides, siblingHub(kind === 'car' ? 'motorbike' : 'car', lang)]
}
