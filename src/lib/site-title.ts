import { SITE_NAME } from '@/lib/edition'
import { POSTING_IS_FREE } from '@/lib/site-identity'

/**
 * THE SITEWIDE <title> AND THE MARKETPLACE'S SHARE-CARD LINE — one copy for the root layout
 * (`src/app/[lang]/layout.tsx`) and the home page's own share card under the `/vi` pilot
 * (`(home)/home-metadata.ts`, V3b), so the two cannot drift.
 *
 * ⛔ NO "TRUSTED" (SEO wave B, V2; CS-3 claim 1, owner 2026-10-01): "eno.vn - Trusted Expat Marketplace in
 * Vietnam" over a shelf mostly linked from other sites was a claim, not a description (the Organization
 * note in the layout says the same). It mirrors /about's title; "free" follows POSTING_IS_FREE.
 */
export const SITE_TITLE = `${SITE_NAME} — ${POSTING_IS_FREE ? 'free ' : ''}classifieds for expats and locals in Vietnam`

/**
 * The marketplace's short self-description, for the OG and Twitter cards. ⛔ NOT "the community keeps
 * listings honest" (CS-3 claim 7): an outcome no code measures; a signed-in member can report a listing.
 * ⛔ NOR "sellers who post here build trust scores" (owner 2026-10-04): official partners show a partner
 * badge instead. It closes on the owner's approved report sentence, verbatim (category-copy.ts
 * REPORT_SENTENCE), as the layout's SITE_DESCRIPTION does.
 * eno.forum's line is SERVICES_SITE_TAGLINE (edition-services-copy.ts), chosen in the layout.
 */
export const MARKETPLACE_TAGLINE = `${POSTING_IS_FREE ? 'Free classifieds' : 'Classifieds'} for expats, internationals and locals in Vietnam. Rentals, jobs, furniture, electronics and more. Members can report any listing that breaks the rules.`
