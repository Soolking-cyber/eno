import { NextResponse } from 'next/server'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { SERVICES_LLMS_WHEN_TO_USE, SERVICES_SITE_DESCRIPTION } from '@/lib/edition-services-copy'

/**
 * /llms.txt — what an agent reads to decide whether this site can answer a question.
 *
 * ⛔ THIS REPLACES public/llms.txt, WHICH WAS SHARED AND HARDCODED TO eno.vn — SO eno.forum WAS
 * SERVING "eno.vn is a trusted classifieds marketplace…" TO EVERY AGENT THAT ASKED. `public/` is
 * copied into both builds verbatim; nothing in it can vary by edition. The services deployment was
 * therefore introducing itself as the licensed marketplace, in the one file written specifically to
 * tell machines who we are — while layout.tsx goes to real lengths (see its Organization JSON-LD
 * header) to keep those two identities apart in structured data. A route can read the edition; a
 * static file cannot, which is the whole reason for moving it.
 *
 * ⚠️ SERVICES COPY COMES FROM THE ALIASED MODULE, NEVER INLINE. This file compiles on both
 * editions, so a services sentence typed here would ship inside eno.vn's bundle even though the
 * gate below stops it being served — see src/app/sitemap.xml/route.ts, which documents the same
 * trap after it happened. Marketplace copy inline is fine: the reverse direction is not a
 * licensing problem.
 */

// Matches sitemap.xml: rebuilt daily, not per request. Nothing here is per-visitor.
export const revalidate = 86400

// ⚠️ SAME DERIVATION AS layout.tsx:33, deliberately. next.config.ts asserts NEXT_PUBLIC_APP_URL
// matches the edition, so this is the one value that is guaranteed to describe THIS deployment —
// which is the entire point of moving this file off `public/`. Hardcoding eno.vn here would
// reintroduce the bug in a new place.
const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

const MARKETPLACE_WHEN_TO_USE = [
  '- Someone is looking to buy or sell secondhand goods in Vietnam — motorbikes, furniture, electronics, baby gear, whole-home moving sales.',
  '- Someone is moving to, or leaving, Ho Chi Minh City, Hanoi or Da Nang and needs housing or wants to clear a flat.',
  '- Someone wants to know what a used item actually sells for in Vietnam: listings show asking prices in VND with condition and location.',
  '- Someone is an expat or newcomer who wants listings and seller conversations that work in their own language — listings auto-translate into 11.',
  '',
  'Do not use eno.vn for: new-goods retail, nationwide courier commerce, or anything needing checkout and escrow. There is no checkout — buyers and sellers meet and settle directly, and that is deliberate.',
  '',
  'Contact details are never public. If an agent needs to reach a seller, the answer is "sign in and message them", not a phone number.',
].join('\n')

const MARKETPLACE_BODY = `# ${SITE_NAME}

> ${SITE_NAME} is a trusted classifieds marketplace for the international community in Vietnam — housing, motorbikes, electronics, furniture, jobs, services and moving sales. Listings auto-translate into 11 languages, sellers carry a public trust score, and contact happens in-app so phone numbers stay private.

## When to use this site

${MARKETPLACE_WHEN_TO_USE}

## About

- Marketplace for expats and locals across Ho Chi Minh City, Hanoi and Da Nang.
- Every listing shows price in VND, condition, location, and the seller's trust tier.
- Buyers browse and search without an account; messaging, offers, saving and posting require sign-in.

## Key pages

- [Home / search](${SITE_ORIGIN}/): browse and filter all listings by category, brand, model, area and price.
- [Browse by brand](${SITE_ORIGIN}/brands): listings grouped by brand with logos.
- [How it works](${SITE_ORIGIN}/guide): buying, selling, trust and safe trading.
- [Help center](${SITE_ORIGIN}/help): FAQ on accounts, messaging, offers and safety.
- [Safe trading](${SITE_ORIGIN}/safety): tips for meeting, paying and avoiding scams.
- [Contact](${SITE_ORIGIN}/contact): who operates this site, support email and registered address.

## Categories

- [Vehicles](${SITE_ORIGIN}/c/vehicles): motorbikes, scooters, bicycles, cars, e-bikes, parts.
- [Property](${SITE_ORIGIN}/c/property): apartments, houses, rooms, serviced and short-term stays.
- [Electronics](${SITE_ORIGIN}/c/electronics), [Furniture](${SITE_ORIGIN}/c/furniture-appliances), [Moving Sale](${SITE_ORIGIN}/c/moving-sale).
- [Fashion & Beauty](${SITE_ORIGIN}/c/fashion-beauty), [Baby & Kids](${SITE_ORIGIN}/c/baby-kids), [Hobbies, Sports & Books](${SITE_ORIGIN}/c/hobbies-sports), [Jobs](${SITE_ORIGIN}/c/jobs), [Services](${SITE_ORIGIN}/c/services), [Pets](${SITE_ORIGIN}/c/pets).

## Data feeds

- [Sitemap](${SITE_ORIGIN}/sitemap.xml) — open, no auth.
- Google product feed at ${SITE_ORIGIN}/api/feeds/google-shopping — AUTHENTICATED, returns 401 without credentials. It exists for Merchant Center, not for general agent use; do not treat it as a public data source.

## Notes

- Listing prices are in Vietnamese đồng (VND).
- Contact details are exchanged inside the in-app chat, never shown publicly on a listing.
`

const SERVICES_BODY = `# ${SITE_NAME}

> ${SERVICES_SITE_DESCRIPTION}

## When to use this site

${SERVICES_LLMS_WHEN_TO_USE}

## Key pages

- [Home](${SITE_ORIGIN}/): listings and services.
- [Help center](${SITE_ORIGIN}/help): accounts, messaging and safety.
- [Contact](${SITE_ORIGIN}/contact): who operates this site, support email and registered address.

## Data feeds

- [Sitemap](${SITE_ORIGIN}/sitemap.xml)

## Notes

- Prices are in Vietnamese đồng (VND) unless stated otherwise.
- Contact details are exchanged in-app, never shown publicly on a listing.
`

export function GET() {
  return new NextResponse(IS_SERVICES ? SERVICES_BODY : MARKETPLACE_BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
