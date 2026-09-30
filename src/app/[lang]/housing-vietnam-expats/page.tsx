import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { pageShare } from '@/lib/site-identity'
import Link from 'next/link'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { LiveCounts } from '@/components/marketplace/live-count'
import { HOME_RENTAL_SUBCATS } from '@/lib/rental-homes'

// 1h, not 7d. The copy IS static, but the page also renders a LIVE 8-listing rail and an
// "inventory is empty" branch — so at weekly regeneration a category that filled on Monday kept
// telling visitors "this part of the marketplace is just getting started" until the following
// Monday. One page per hour is a rounding error against the feed's own traffic; a week of wrong
// copy on the pages built to convert search traffic is not (astra).
// ⚠️ It is also what keeps the live rentals line below honest: that count is re-read every hour.
export const revalidate = 3600

/**
 * ⛔ EVERY CLAIM HERE MUST BE TRUE OF A LINKED RENTAL TOO — the jobs-vietnam-expats rule, for the same
 * reason. Measured 2026-09-27: all 8 rail cards on this page were Nhatot imports ("Listed on
 * Nhatot.com", an outbound "Rent on" button, no in-app chat), 100 of 100 sampled rentals carried a
 * partner link, and 0 of 25,502 rentals were outside Ho Chi Minh City. The copy this replaces promised
 * that "every eno.vn seller has a public trust score", that you "message the landlord or agent directly
 * through eno.vn", housing "across Ho Chi Minh City and beyond", and that "scams and recycled photos are
 * common on open listing sites" — the last one about the very portals the rail is built from. In
 * FAQPage markup those are consumer claims (Consumer Protection Law 19/2023).
 *
 * ⚠️ REWORDED, NOT DELETED. Trust scores and in-app chat are real — for listings POSTED here. So the
 * copy says which kind of listing gets which, and that a linked listing links to its source.
 * ⛔ AND IT NEVER SAYS A LINKED RENTAL IS HANDLED AT ITS SOURCE. The owner removed "enquiries and
 * viewings are handled there, not by eno" from the importers on 2026-09-25
 * (src/lib/import-viewing-disclaimer.ts): the eno team checks availability, free, on ANY rental —
 * the check button on every card and listing page (rental-check-toggle.tsx). An FAQ answering "does
 * eno check the rentals?" with "not the linked ones" contradicted that button in FAQPage markup.
 *
 * ⚠️ HO CHI MINH CITY IS THE PAGE'S SUBJECT, NOT A COUNT IT ASSERTS. The prose describes the city's
 * rental districts, which is true whatever is listed; the one sentence that says "every rental here is
 * in Ho Chi Minh City" is computed at render (`lede` below) and disappears the hour it stops being
 * true. The title keeps "Expat housing in Vietnam" because that is the query (~170/mo) — and /c/rentals,
 * not this page, is the target for "apartment for rent in Ho Chi Minh City", so the two do not compete
 * for one query with one rail.
 */
export const metadata: Metadata = {
  title: `Expat Housing in Vietnam: Renting in Ho Chi Minh City | ${SITE_NAME}`,
  description:
    'Expat housing in Ho Chi Minh City — apartments, houses and rooms for rent in Thao Dien, District 2, District 7, District 1 and Binh Thanh, and what to check before you view, sign and pay a deposit.',
  alternates: { canonical: '/housing-vietnam-expats' },
  ...pageShare({
    title: `Expat Housing in Vietnam: Renting in Ho Chi Minh City | ${SITE_NAME}`,
    description: 'Apartments, houses and rooms for rent in Ho Chi Minh City, and what to check before you sign.',
  }),
}

/**
 * ⚠️ FROM THE REGISTRY, NOT HAND-TYPED, so a renamed guide or a changed label cannot leave a dead card
 * here. `marketplaceGuidesExcept()` with no slug returns the ENGLISH guides only (this landing is
 * English), and a slug that stops existing drops out instead of linking a 404.
 * seo-landing-related.test.ts asserts all three still resolve.
 */
const RELATED_GUIDES = ['/renting-an-apartment-vietnam-foreigner', '/rental-deposit-vietnam', '/furnishing-a-home-in-vietnam']

/**
 * The areas "Popular expat areas" names, linked to their district pages — the section says each has
 * its own rentals page, so the page links them (district pages are kept out of the sitemap, so links
 * are how they are found). ⚠️ CANONICAL SLUGS ONLY (src/lib/district-canonical.ts): a `quan-2` link
 * would be a 308. Names come from DISTRICTS, and a key that stops existing drops out rather than
 * linking a 404; seo-landing-related.test.ts checks every key is a curated place.
 */
const AREA_SLUGS = ['d2', 'd7', 'd1', 'd3', 'binh-thanh']
const AREAS = AREA_SLUGS.flatMap((slug) => DISTRICTS.filter((d) => d.slug === slug))
// English copy, like CONTENT above (this landing is English on every render).
const AREAS_LEAD = 'Rentals by district:'

const CONTENT: SeoContent = {
  eyebrow: 'Housing · Ho Chi Minh City',
  h1: 'Expat Housing in Vietnam: Renting in Ho Chi Minh City',
  intro: `Looking for somewhere to live in Vietnam? This page covers Ho Chi Minh City: apartments, houses, rooms and serviced flats for rent, from studios to family houses, furnished or not, on monthly or yearly terms. Many listings are linked from partner property portals: each says where it is listed and links to the original posting. Listings posted directly on ${SITE_NAME} show the seller’s public trust score and can be messaged in-app, and on any rental the eno team will check availability for you, free.`,
  // ⚠️ `rentals`, not `house-rentals` — that slug does not exist and never did on this taxonomy.
  // Both CTAs on this page fed `/c/house-rentals`, which renders the not-found boundary, and the
  // listing strip queried a category slug matching nothing so it was permanently empty. A rename
  // orphaned it silently because nothing type-checks a slug string. `seo-landing.test.ts` now
  // asserts every landing's categorySlug resolves, which is the class of bug rather than this one.
  // Rentals (not `property`) is right per the taxonomy split: rentals owns ALL rent intent,
  // property is buy-sell only, and an expat looking for somewhere to live is renting.
  categorySlug: 'rentals',
  // ⛔ HOMES ONLY — apartments, houses, rooms (src/lib/rental-homes.ts). `rentals` also holds offices
  // and shopfronts, and measured 2026-09-29 four of this rail's eight cards were Office/shopfront (a
  // 1,400m² unit among them) under a page about where an expat lives. The live count below is the
  // same set, so the number and the rail agree (C1-HOUSING).
  subcategoryIn: HOME_RENTAL_SUBCATS,
  // Not "Trusted listings" (the component default): the rail is mostly partner imports that
  // nobody here has vetted, the same reason the jobs landing renames its rail.
  railTitle: 'Latest rentals',
  trustStrip: false,
  cta: 'Browse rentals',
  sections: [
    {
      title: 'Popular expat areas',
      body: 'Thao Dien and An Phu (District 2) are the long-time favourites of international families, with international schools, greenery and Western cafés. Phu My Hung (District 7) offers planned, well-managed apartment compounds, while District 1, District 3 and Binh Thanh suit people who want to be close to the centre. Each district has its own rentals page, so you can browse by area.',
    },
    {
      title: 'What you’ll find',
      body: `Apartments, houses, rooms and offices for rent — serviced and unserviced, furnished and unfurnished, from monthly stays to yearly leases. Each listing shows the asking price, the district and photos. A listing linked from a partner portal says where it is listed, and its button opens the original posting. A listing posted directly on ${SITE_NAME} can be messaged in-app. On either kind, the check button asks the eno team to check availability for you, free.`,
    },
    {
      title: 'Before you pay anything',
      body: `Wherever a listing comes from, view the flat in person before any money moves, and make sure the person you pay is the owner or the agent the owner appointed. In Ho Chi Minh City the landlord customarily pays the agent, so a fee asked of you just to view a flat is worth questioning before you pay it. On listings posted here, the seller’s public trust score sits beside their name, and anyone can report a listing that looks wrong.`,
    },
  ],
  related: RELATED_GUIDES.flatMap((href) => marketplaceGuidesExcept().filter((g) => g.href === href)),
  faqs: [
    {
      q: 'Where do expats rent in Ho Chi Minh City?',
      a: 'Thao Dien and An Phu (District 2) and Phu My Hung (District 7) are the most popular with international residents; District 1, District 3 and Binh Thanh suit people who want to be central.',
    },
    {
      q: 'How do I contact a landlord or agent?',
      a: `It depends on where the listing comes from. A listing linked from a partner portal says where it is listed, and its button opens the original posting on that portal, where you can reach the landlord or agent. A listing posted directly on ${SITE_NAME} has a Message button for in-app chat; you can ask for a phone number or Zalo once the other side replies. On any rental you can also tap the check button, and the eno team checks availability for you, free.`,
    },
    {
      q: `Does ${SITE_NAME} check the rentals listed here?`,
      a: `It checks availability on request, free: tap the check button on up to 5 rentals and the eno team checks them for you. It does not vet the linked listings themselves — those are the partner portals’ own postings. Listings posted directly here show the seller’s public trust score, built from completed deals, reviews and confirmed reports, and anyone can report a listing that looks wrong. Whichever kind it is, view the place in person before you pay anything.`,
    },
  ],
}

export default function Page() {
  return (
    <SeoLanding
      content={CONTENT}
      lede={
        // ⛔ THE ONE SENTENCE ON THIS PAGE THAT STATES A NUMBER, AND IT IS COMPUTED. "Every one of them
        // in Ho Chi Minh City" renders only while every live rental IS there; the first Hanoi flat
        // removes the clause on the next hourly render. On a failed count the line is not rendered at
        // all — the page never falls back to a remembered figure.
        <>
          <LiveCounts targets={{ rentals: { categorySlug: 'rentals', subcategoryIn: HOME_RENTAL_SUBCATS, allIn: 'Ho Chi Minh' } }} lang="en">
            {({ rentals }) =>
              rentals && (
                <p className="mt-4 max-w-prose text-sm leading-relaxed text-body">
                  {/* "homes", not "rentals": the count is the rail's set (apartments, houses, rooms), and
                      "N rentals" would read as the whole category that /c/rentals counts larger. */}
                  {rentals.allInside
                    ? `${rentals.count} homes are listed for rent right now, every one of them in Ho Chi Minh City.`
                    : `${rentals.count} homes are listed for rent right now.`}
                </p>
              )
            }
          </LiveCounts>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-body">
            {AREAS_LEAD}{' '}
            {AREAS.map((d, i) => (
              <span key={d.slug}>
                {i > 0 && ', '}
                <Link href={`/c/rentals/${d.slug}`} className="font-semibold text-accent-foreground hover:underline">
                  {d.nameEn}
                </Link>
              </span>
            ))}
            .
          </p>
        </>
      }
    />
  )
}
