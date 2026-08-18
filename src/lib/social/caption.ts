import { formatMoneyFull } from '@/lib/vnd'

/**
 * THE POST TEXT, AND THE FIRST 25 CHARACTERS ARE THE WHOLE POINT.
 *
 * ⛔ LINKEDIN BUILDS THE POST'S URL SLUG FROM THE FIRST ~25 CHARACTERS of the body (or from its
 * hashtags) — LinkedIn Help, "Finding the URL for shared content". LinkedIn's domain authority is
 * far above eno.vn's, so those 25 characters are the single highest-leverage string this app
 * publishes anywhere: they become the slug, and they lead the title and meta description that a
 * search engine (and an AI overview) reads.
 *
 * So the opening is a SEARCH PHRASE, never branding. The difference is entire:
 *
 *   "New listing on eno.vn: Ho…"  → slug `new-listing-on-eno-vn-ho`   ← 25 chars of nothing
 *   "Apartments for rent in Ho…"  → slug `apartments-for-rent-in-h`   ← the query people type
 *
 * ⚠️ THE OPENING IS ALSO A CLAIM, AND IT STAYS DESCRIPTIVE. The tempting version of this tactic is
 * a superlative ("Vietnam's #1 marketplace…") because it ranks. Vietnam's Advertising Law
 * restricts "nhất" / "số một" / "tốt nhất" style claims unless they are documented, and eno is now
 * a registered Vietnamese company with published Operating Regulations and a pending MoIT platform
 * filing. Every opener here describes inventory that demonstrably exists, which needs no defending.
 */

/** LinkedIn's slug window. Exported so the test can assert against one number, not a magic literal. */
export const SLUG_CHARS = 25

export type PostInput = {
  id: string
  title: string
  price: number
  currency: string
  location: string
  district: string | null
  image: string | null
  categoryName: string
  /** Search-first opener, e.g. "Apartments for rent in Ho Chi Minh City". Falls back to the title. */
  keyphrase?: string | null
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

export function listingUrl(id: string, source?: string) {
  // ⚠️ utm_source per channel, so the analytics answer "which network actually sends buyers" is
  // available later without re-deriving it from referrers, which social apps strip.
  return source ? `${APP_URL}/listings/${id}?utm_source=${source}&utm_medium=social` : `${APP_URL}/listings/${id}`
}

/**
 * The opener: the phrase a person would type into a search box.
 *
 * ⚠️ CATEGORY + PLACE, IN THAT ORDER, because that is how the query is typed ("apartments for rent
 * in ho chi minh city"), and because the category is the half that must survive the 25-character
 * cut when the place name is long.
 */
export function opener(l: PostInput): string {
  if (l.keyphrase) return l.keyphrase
  const where = l.district || l.location
  return where ? `${l.categoryName} in ${where}` : l.categoryName
}

/** Body for the feed channels. `source` tags the link for analytics. */
export function caption(l: PostInput, source: string): string {
  const where = l.district || l.location
  return [
    opener(l),
    '',
    l.title,
    `${formatMoneyFull(l.price, l.currency, 'vi')}${where ? ` · ${where}` : ''}`,
    listingUrl(l.id, source),
  ].join('\n')
}
