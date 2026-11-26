import { SITE_NAME } from '@/lib/edition'
import { POSTING_IS_FREE } from '@/lib/site-identity'

/**
 * THE SITEWIDE <title> AND THE MARKETPLACE'S SHARE-CARD LINE — one copy for the root layout
 * (`src/app/[lang]/layout.tsx`) and the home page's own share card under the `/vi` pilot
 * (`(home)/home-metadata.ts`, V3b), so the two cannot drift.
 *
 * ⛔ NO "TRUSTED" (SEO wave B, V2; CS-3 claim 1, owner 2026-10-01): "eno.vn - Trusted Expat Marketplace in
 * Vietnam" over a shelf mostly linked from other sites was a claim, not a description (the Organization
 * note in the layout says the same). The words are /about's ("About eno.vn — free classifieds …"); the order is not since
 * 2026-11-23 (the site's name last, below). "free" follows POSTING_IS_FREE.
 */
// ⚠️ THE SITE'S NAME LAST, as every other page's "<page> | eno.vn" (Seobility, 2026-11-23: a title that opens on the domain is a
// "critical" there, on / and /vi).
// The page's main words (owner 2026-11-24, SEO Site Checkup "use the main keyword in the title, description and an H1"): the home's
// most common words are its cards' — homes, cars, used goods — so title, description (layout.tsx) and h1 ((home)/layout.tsx) name
// them, and /vi's title, description and h1 the same in Vietnamese ((home)/home-metadata.ts).
// ⛔ UNDER 60 CHARACTERS (owner 2026-11-26, "title under 60", after an SEO/GEO audit flagged 61): "Free classifieds in Vietnam"
// became "Free Vietnam classifieds" (58 on eno.vn), which carries the searched phrase word for word (GSC 28 d to 2026-11-23:
// "vietnam classifieds" #6.5, "classifieds" #4.7; compare the home's queries again from ~2026-12-24). eno.forum is Reach since
// 11-04, so this edition's forum title (61) is never served.
export const SITE_TITLE = `${POSTING_IS_FREE ? 'Free Vietnam classifieds' : 'Vietnam classifieds'}: homes, cars, used goods | ${SITE_NAME}`

/**
 * The marketplace's short self-description, for the OG and Twitter cards. ⛔ NOT "the community keeps
 * listings honest" (CS-3 claim 7): an outcome no code measures; a signed-in member can report a listing.
 * ⛔ NOR "sellers who post here build trust scores" (owner 2026-10-04): official partners show a partner
 * badge instead. It closes on the owner's approved report sentence, verbatim (category-copy.ts
 * REPORT_SENTENCE), as the layout's SITE_DESCRIPTION does.
 * eno.forum's line is SERVICES_SITE_TAGLINE (edition-services-copy.ts), chosen in the layout.
 */
export const MARKETPLACE_TAGLINE = `${POSTING_IS_FREE ? 'Free classifieds' : 'Classifieds'} for expats, internationals and locals in Vietnam. Rentals, jobs, furniture, electronics and more. Members can report any listing that breaks the rules.`

/**
 * THE ENGLISH HOME'S SHARE CARD (owner 2026-11-22, "score maxing" an SEO meta checker that wants og:title at 25–35 and
 * og:description at 55–65 characters). CARD ONLY: the page's <title> and meta description stay SITE_TITLE and the
 * layout's SITE_DESCRIPTION, which search engines show. Same positioning, no claim the copy rules forbid (no "trusted").
 * ⚠️ home-metadata.test.ts pins both lengths inside those ranges — re-check them if the flag or the wording changes.
 */
export const HOME_SHARE_TITLE = `${SITE_NAME} — Vietnam's ${POSTING_IS_FREE ? 'free ' : ''}classifieds`
export const HOME_SHARE_DESCRIPTION = 'Rentals, jobs and used goods for expats and locals in Vietnam.'
