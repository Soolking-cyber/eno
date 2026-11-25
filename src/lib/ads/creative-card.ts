/**
 * ── A CREATIVE AD AS THE FEED SENDS IT (owner 2026-11-25: one standard placement, the feed card). Isomorphic: the feed
 * (src/lib/ads/serve.ts) builds it, the explorer draws it (ad-creative-card.tsx). It travels as the feed's SEPARATE
 * `adCreative` field, never inside `listings[]` — dedupe, map pins, onOpen and the list rows all read that array.
 * The words are the advertiser's, in their language; `headlineI18n` / `bodyI18n` carry the viewer's language when the
 * translation store already holds it (the client translates the rest the way listing titles are, then caches it).
 */
export type AdCreativeCardData = {
  adId: string
  advertiserName: string
  headline: string
  body: string | null
  headlineI18n?: Record<string, string>
  bodyI18n?: Record<string, string>
  imageUrl: string
  clickUrl: string
}

/** The disclosure the card carries, the same in every language (owner 2026-11-25: "Quảng cáo · Ad"). */
export const AD_CREATIVE_LABEL = 'Quảng cáo · Ad'

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const https = (v: unknown): v is string => {
  if (!str(v, 2048)) return false
  try { return new URL(v).protocol === 'https:' } catch { return false }
}
const i18n = (v: unknown) => v === undefined || (!!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => str(x, 400)))

/** The feed's `adCreative`, checked before anything draws it: an https picture and link, short words — else nothing. */
export function isAdCreativeCardData(v: unknown): v is AdCreativeCardData {
  const c = v as Partial<AdCreativeCardData> | null
  return !!c && typeof c === 'object' && str(c.adId, 64) && str(c.advertiserName, 60) && str(c.headline, 120) &&
    (c.body === null || str(c.body, 240)) && https(c.imageUrl) && https(c.clickUrl) && i18n(c.headlineI18n) && i18n(c.bodyI18n)
}
