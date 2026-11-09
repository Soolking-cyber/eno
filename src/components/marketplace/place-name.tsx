'use client'

import { useLanguage, useTr } from '@/context/language-context'
import { adminPlaceEn, placeNamedIn } from '@/lib/city-short'

/**
 * A place name in the reader's language: the Vietnamese as written for a Vietnamese reader, its English spelling for every
 * other one. ⛔ i18n-invariant — a place name is never machine-translated (the rule this component exists for; moved here
 * from the /c pages on 2026-11-10 so the listing page and the cards share it).
 */
export function PlaceName({ en, vi }: { en: string; vi: string }) {
  const { lang } = useLanguage()
  // i18n-invariant: a place name — never machine-translated (the rule this component exists for).
  return <>{lang === 'vi' ? vi : en}</>
}

/**
 * A stored location as the reader should see it. Wholly administrative ("Huyện Nhà Bè (Xã Nhà Bè)", city-short.ts
 * adminPlaceEn) → never machine-translated: the Vietnamese for a Vietnamese reader, its English spelling for everyone else
 * — machine translation made it "La maison de la bête" for a French one (best-practice gap 2026-11-10). Anything else goes
 * through `useTr` exactly as before (identity in English and Vietnamese, translated for the other languages).
 */
export function usePlaceText(location: string): string {
  const { lang } = useLanguage()
  const en = adminPlaceEn(location)
  const translated = useTr(en ? '' : location)
  return en ? (lang === 'vi' ? location : en) : translated
}

/**
 * The map popup's place line. The location through usePlaceText; the district AS STORED — a proper noun, and machine
 * translation of district names is how "Bình Thạnh" became word salad — except that an administrative one is spelled for a
 * non-Vietnamese reader like the location beside it, so the line never mixes "Quận 7" with "Tan Phong Ward" (2026-11-10).
 * The district is left out where the location already names it, as whole words ("…, Quận 7 TP.HCM" names "Quận 7";
 * "Quận 12" does not name "Quận 1"). A component because the popup's listing changes while the map stays mounted, and a hook cannot be called
 * conditionally inside it. The full city name stays (the popup is 300px; the card's "HCM" is a width fix).
 */
export function PopupPlace({ district, location }: { district: string | null; location: string }) {
  const { lang } = useLanguage()
  const city = usePlaceText(location)
  // In the location's register: spelled only beside a spelled location, so the line never mixes "District 7" with "Phường …".
  const shownDistrict = district ? (lang !== 'vi' && adminPlaceEn(location) && adminPlaceEn(district)) || district : null
  // …as stored or as spelled, whoever reads it: a location kept in English ("District 7, HCMC") names "Quận 7" too (review).
  const districtEn = district ? adminPlaceEn(district) : null
  const named = !!district && (placeNamedIn(location, district) || (!!districtEn && placeNamedIn(location, districtEn)))
  return <>{shownDistrict && !named && district !== location ? `${shownDistrict}, ${city}` : city}</>
}
