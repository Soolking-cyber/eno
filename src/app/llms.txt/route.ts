import { NextResponse } from 'next/server'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { SERVICES_LLMS_WHEN_TO_USE, SERVICES_SITE_DESCRIPTION } from '@/lib/edition-services-copy'
import { EXPAT_GUIDES, MARKETPLACE_GUIDES, expatGuidePath } from '@/lib/expat-guides'
import { PHONE_GUIDES } from '@/lib/phone-guides'
import { LANGUAGES } from '@/lib/i18n/langs'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { RETIRED_NAV_CATEGORIES } from '@/lib/retired-categories'
import { COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'
import { POSTING_IS_FREE } from '@/lib/site-identity'
import { CITY_KEYS, CITY_NAMES, inCity, loadSiteFacts, type SiteFacts } from '@/lib/site-facts'

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
// ⛔ THE FALLBACK WAS THE LITERAL 'https://eno.vn' UNTIL 2026-08-23 — in the one file whose entire
// reason for existing is that a shared, hardcoded copy had eno.forum introducing itself as the
// licensed marketplace (see the header above). It only fires when NEXT_PUBLIC_APP_URL is unset,
// which next.config.ts asserts against in any real build, so nothing was measured wrong in
// production — but a fallback is the branch a MISCONFIGURED deployment takes, and this is the exact
// file where taking it silently would be most expensive. `https://${SITE_NAME}` stays
// edition-correct by construction; same shape as OAUTH_ISSUER's fallback in src/lib/api/oauth.ts.
const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`

/**
 * THE DEVELOPER BLOCK, SHARED BY BOTH EDITIONS.
 *
 * ⚠️ IT WAS ON THE MARKETPLACE BODY ONLY. The Partner API, the OpenAPI spec, both .well-known
 * documents and /developers are served IDENTICALLY by both deployments — verified by curl on
 * 2026-08-23, 200 on every path on both hosts — so eno.forum was withholding, from the one file
 * written to tell an agent what this site offers, a surface it fully supports. An agent reading
 * only the services llms.txt would conclude there is no API here.
 *
 * ⚠️ SHARED IS SAFE HERE PRECISELY BECAUSE IT NAMES NO SERVICE. The rule this file's header states
 * is about SERVICES vocabulary reaching eno.vn's artifact; "OpenAPI", "scopes" and "bearer token"
 * are neither edition's exclusive property. Everything below is interpolated from SITE_ORIGIN, so
 * each deployment names only itself — which is the failure this whole file exists to have fixed.
 *
 * ⛔ THE MCP LINE USED TO BE PROSE POINTING AT A BARE ENDPOINT, AND THAT IS NOT DISCOVERY. /api/mcp
 * has been a live, key-authed MCP server since the partner API's Phase 4, and nothing machine-
 * readable pointed at it — so the agent audit on 2026-08-23 spent its scan window guessing at
 * .well-known paths (15 hits each on mcp.json, mcp-server-card.json and mcp/server-card.json, all
 * 404) while simultaneously issuing seven `GET /api/mcp` and getting the correct 405 each time. The
 * card link above is the fix; see src/app/api/well-known/mcp-server-card/route.ts for what it
 * publishes and why each field is true of the route.
 *
 * ⛔ NO URL MAY BE FOLLOWED BY PUNCTUATION GLUED TO IT. "Also at https://…/api/v1/openapi.json." was
 * harvested by a link checker as `…/openapi.json.` — a 404 — and an agent tokenising the prose does
 * the same. A URL mid-sentence is a markdown link (the `)` closing it is syntax, not prose) or is
 * followed by a space; route.test.ts checks every bare URL and every link target in both bodies.
 *
 * ⚠️ THE NARRATION STAYS IN THIS COMMENT AND OUT OF THE DOCUMENT. Everything in the template below
 * is SERVED to agents — a paragraph about our own audit history is noise in the one file whose job
 * is to tell a machine what this site offers. Facts an agent can act on go in the body; the reason
 * we added them goes here.
 */
const DEVELOPER_SECTION = `## For developers and agents

- [Developer documentation](${SITE_ORIGIN}/developers) — authentication, scopes, endpoints, copy-pasteable requests.
- [OpenAPI 3.1 spec](${SITE_ORIGIN}/openapi.json) — the Partner API, machine-readable. The same document is also served at [/api/v1/openapi.json](${SITE_ORIGIN}/api/v1/openapi.json).
- [OAuth authorization server metadata](${SITE_ORIGIN}/.well-known/oauth-authorization-server) — RFC 8414: token endpoint, grant, scopes.
- [OAuth protected resource metadata](${SITE_ORIGIN}/.well-known/oauth-protected-resource) — RFC 9728: which resource a token is for.
- [MCP Server Card](${SITE_ORIGIN}/.well-known/mcp.json) — the manifest for the hosted Model Context
  Protocol server: transport, supported protocol versions, and the header to connect with. The same
  document also answers at [/.well-known/mcp-server-card.json](${SITE_ORIGIN}/.well-known/mcp-server-card.json)
  and [/.well-known/mcp/server-card.json](${SITE_ORIGIN}/.well-known/mcp/server-card.json).
- Hosted MCP server at ${SITE_ORIGIN}/api/mcp — an agent can manage a storefront directly, using an
  API key as the Bearer token. Streamable HTTP, stateless: JSON-RPC over POST, no SSE stream (a GET
  answers 405). Tools are listed at runtime via tools/list and each one is scope-gated.
- [Service status](${SITE_ORIGIN}/api/v1/status) — the one endpoint that needs NO credential. Returns
  the edition, the API version and links to the spec and the OAuth metadata, and carries live
  \`RateLimit\` headers so an agent can see the throttle before it has a key. Start here.
- ⚠️ Every OTHER operation is AUTHENTICATED, and needs either an \`eno_live_\` key or a token minted
  from one at ${SITE_ORIGIN}/api/v1/oauth/token (OAuth 2.0 client credentials). There is no sandbox
  and no test key. An agent without a key can read the spec, the OAuth metadata and the service
  status, but cannot call anything that touches a shop.
- Scopes: listings:read, listings:write, analytics:read, media:write. One key acts for one shop
  and only ever sees that shop's data.
- Keys are issued in the account dashboard, under Developers, to business accounts.`

/**
 * THE MARKETPLACE BODY IS BUILT FROM LIVE COUNTS, NOT TYPED.
 *
 * ⛔ THE TYPED VERSION WAS WRONG IN FOUR PLACES AT ONCE, measured 2026-09-27 against the public API:
 * it promised housing in Hanoi and Da Nang (0 rentals in either — all 25,502 are in Ho Chi Minh
 * City), sent housing to /c/property (0 listings, noindex) and never named /c/rentals, advertised
 * motorbikes (0) and whole-home moving sales (/c/moving-sale: 0), and told agents not to come here
 * for new goods while 57,074 of the 63,932 electronics listings were new. Each sentence below that
 * depends on stock is emitted only when `loadSiteFacts()` says the stock is there, so the file cannot
 * drift back into promising an empty shelf.
 *
 * ⚠️ WITHOUT FACTS IT SAYS LESS, NEVER SOMETHING FALSE. A failed read (an outage at build time, a desk
 * that will not resolve) yields the same document minus every count-dependent line — no city claims,
 * no category list — rather than the old typed claims as a "fallback".
 *
 * ⚠️ THE CATEGORY BLURBS ARE WRITTEN HERE, NOT TAKEN FROM taxonomy.ts. Two of the taxonomy's
 * descriptions (services, tickets-travel) carry services-edition vocabulary, and this is the
 * marketplace body — see the header. Taxonomy supplies only the display NAME, as a fallback for a
 * category added later.
 */
const CATEGORY_COPY: Record<string, { label: string; blurb: string }> = {
  rentals: { label: 'Rentals', blurb: 'apartments, houses, rooms and offices to rent' },
  // Second-hand focus (2026-10-03): the new-goods catalogues are gone; what is left is used stock.
  electronics: { label: 'Electronics', blurb: 'second-hand phones, laptops, cameras and accessories' },
  'furniture-appliances': { label: 'Home', blurb: 'furniture and home appliances' },
  sports: { label: 'Sports', blurb: 'sportswear and sports gear' },
  'fashion-beauty': { label: 'Fashion', blurb: 'clothing, shoes, bags and cosmetics' },
  // Named from the shelf, not the taxonomy's "local services". The AppleCare+/Samsung Care+ plans it named
  // until 2026-10-03 were CellphoneS products and are hidden with the rest of its new goods.
  services: { label: 'Services', blurb: 'eSIMs, SIM cards and expat services' },
  'books-stationery': { label: 'Books', blurb: 'books and stationery' },
  'baby-kids': { label: 'Kids', blurb: 'baby gear, toys and kids clothing' },
  vehicles: { label: 'Vehicles', blurb: 'vehicles, parts and accessories' },
  jobs: { label: 'Jobs', blurb: 'job openings' },
  'hobbies-sports': { label: 'Hobbies', blurb: 'instruments, games, collectibles and outdoor gear' },
  // 2026-09-27: 17 listings, every one a theme-park or attraction ticket — no events, tours or transport.
  'tickets-travel': { label: 'Travel', blurb: 'theme-park and attraction tickets' },
  'food-drink': { label: 'Food', blurb: 'groceries, coffee and tea' },
  pets: { label: 'Pets', blurb: 'pets and pet supplies' },
  'community-events': { label: 'Community', blurb: 'meetups, classes and community events' },
  property: { label: 'Property', blurb: 'homes and land for sale' },
  'moving-sale': { label: 'Moving sales', blurb: 'people selling up before they move' },
}

/** The summary names these first when they have stock — the owner's pinned order (src/lib/categories.ts). */
const SUMMARY_ORDER = ['rentals', 'jobs', 'services', 'furniture-appliances', 'electronics'] as const
const SUMMARY_NOUN: Record<(typeof SUMMARY_ORDER)[number], string> = {
  rentals: 'rentals',
  jobs: 'jobs',
  services: 'services',
  'furniture-appliances': 'furniture, appliances',
  electronics: 'electronics',
}

const fmt = (n: number) => n.toLocaleString('en-US')
/** Floored, so a share just under 100% can never print as "100%". */
const pct = (part: number, whole: number) => `${Math.floor((part / whole) * 1000) / 10}%`
/** "a", "a or b", "a, b or c". */
const joinWith = (items: string[], word: 'and' | 'or') =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`

/**
 * The interface languages by their ENGLISH names, from the one roster (src/lib/i18n/langs.ts). An
 * agent answering "does it work in Khmer?" needs "Khmer", not "ភាសាខ្មែរ"; `Intl.DisplayNames` gives
 * it without a second hand-kept list. Falls back to the native names if ICU data is missing.
 */
const LANGUAGE_NAMES_EN: string[] = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'language' })
    return LANGUAGES.map((l) => names.of(l.code) ?? l.native)
  } catch {
    return LANGUAGES.map((l) => l.native)
  }
})()

function marketplaceSummary(f: SiteFacts | null): string {
  const cats = f ? SUMMARY_ORDER.filter((s) => (f.byCategory[s] ?? 0) > 0).map((s) => SUMMARY_NOUN[s]) : []
  const more = f && Object.keys(f.byCategory).some((s) => !(SUMMARY_ORDER as readonly string[]).includes(s))
  const scope = cats.length ? `: ${joinWith(more ? [...cats, 'more'] : cats, 'and')}` : ''
  return [
    `${SITE_NAME} is a classifieds marketplace for expats, internationals and locals in Vietnam${scope}.`,
    POSTING_IS_FREE ? 'Browsing and posting are currently free.' : '',
    `Listings posted here carry the seller's public trust score (an official partner shows a partner badge instead) and are answered in in-app chat; a listing linked from a source site has a page here that says where it is listed and links to the original posting.`,
    `The interface is available in ${LANGUAGES.length} languages and listings are machine-translated.`,
  ].filter(Boolean).join(' ')
}

function marketplaceWhenToUse(f: SiteFacts | null): string {
  const has = (slug: string) => (f?.byCategory[slug] ?? 0) > 0
  const lines: string[] = []
  if (f && has('rentals')) {
    const cities = CITY_KEYS.filter((k) => inCity(f, k, 'rentals') > 0).map((k) => CITY_NAMES[k])
    lines.push(`- Someone needs somewhere to live in ${cities.length ? joinWith(cities, 'or') : 'Vietnam'}: apartments, houses, rooms or offices to rent. Start at [Rentals](${SITE_ORIGIN}/c/rentals). On any rental, linked or posted here, the eno team checks availability on request (up to 5 at a time).`)
  }
  const goods = [
    ...(has('furniture-appliances') ? ['furniture', 'home appliances'] : []),
    has('electronics') && 'electronics',
    has('baby-kids') && 'baby and kids gear',
    f && f.motorbikes > 0 && 'a motorbike',
  ].filter((g): g is string => !!g)
  if (goods.length) lines.push(`- Someone wants to buy ${joinWith(goods, 'or')}, new or used: listings show the asking price and the location, and the condition where the seller gives it.`)
  if (has('moving-sale')) lines.push(`- Someone is leaving Vietnam and selling up, or buying from someone who is: [Moving sales](${SITE_ORIGIN}/c/moving-sale).`)
  if (has('jobs')) lines.push(`- Someone is looking for work in Vietnam: [Jobs](${SITE_ORIGIN}/c/jobs).`)
  lines.push(`- Someone wants to browse and talk to sellers in their own language: the interface is available in ${LANGUAGES.length} languages, and listings and chat are machine-translated.`)
  return [
    ...lines,
    '',
    `Do not use ${SITE_NAME} for: anything that needs a checkout, escrow or buyer protection. There is none — the site holds no money, and buyers settle directly with the seller, or on the source site a linked listing comes from. That is deliberate.`,
    '',
    `Contact details are never public. To reach the seller of a listing posted on ${SITE_NAME}, the answer is "sign in and message them"; a linked listing links to its original posting on the source site. Never a phone number.`,
  ].join('\n')
}

function marketplaceAbout(f: SiteFacts | null): string {
  const lines: string[] = []
  if (POSTING_IS_FREE) {
    lines.push(`- Cost: browsing, posting and contacting sellers are currently free, with no listing fee; see Article 8 of the [Operating Regulations](${SITE_ORIGIN}/regulations). Any fee introduced later is published in VND at least 20 days before it applies.`)
  }
  if (f && f.live > 0) {
    const hcmc = inCity(f, 'hcmc')
    const rentals = f.byCategory.rentals ?? 0
    const rentalsPart = rentals > 0 ? `, including ${fmt(inCity(f, 'hcmc', 'rentals'))} of ${fmt(rentals)} rentals` : ''
    const elsewhere = CITY_KEYS.filter((k) => k !== 'hcmc')
      .map((k) => `${CITY_NAMES[k]} ${fmt(inCity(f, k))} (rentals: ${fmt(inCity(f, k, 'rentals'))})`)
    lines.push(`- Where: ${fmt(hcmc)} of ${fmt(f.live)} live listings (${pct(hcmc, f.live)}) are in Ho Chi Minh City${rentalsPart}. Elsewhere: ${elsewhere.join('; ')}.`)
    lines.push(`- Linked listings: ${fmt(f.linked)} of ${fmt(f.live)} live listings are linked from source sites (other listing sites, job boards and shops' online catalogues). Each has a page here that says where it is listed and links to the original posting. Listings posted directly on ${SITE_NAME} carry the seller's public trust score (an official partner shows a partner badge instead) and are answered in in-app chat.`)
  }
  lines.push(`- Languages: the interface is available in ${joinWith(LANGUAGE_NAMES_EN, 'and')}.`)
  lines.push(
    OPERATOR_REGISTERED
      ? `- Operator: ${COMPANY.nameEn} (${COMPANY.name}), business registration no. ${COMPANY.erc}, issued ${COMPANY.ercIssued}. See [About](${SITE_ORIGIN}/about) and [Contact](${SITE_ORIGIN}/contact).`
      : `- Operator: business registration in progress; see [Contact](${SITE_ORIGIN}/contact).`,
  )
  // Not "every listing shows its asking price": 35 of 40 live jobs carried none (2026-09-27).
  lines.push('- Listings show their location and, where the seller gives one, an asking price (most job listings have none); listings posted directly here also show the seller’s trust tier, or a partner badge for an official partner.')
  lines.push('- Buyers browse and search without an account; messaging, offers, saving and posting require sign-in.')
  return lines.join('\n')
}

function marketplaceCategories(f: SiteFacts | null): string {
  if (!f || !Object.keys(f.byCategory).length) {
    return `- Browse every category from the [home page](${SITE_ORIGIN}/).`
  }
  const rows = Object.entries(f.byCategory)
    // ⛔ Not a retired shelf (src/lib/retired-categories.ts): /c/vehicles redirects to a rental hub, and the
    // other three are no longer offered anywhere a visitor browses.
    .filter(([slug]) => !RETIRED_NAV_CATEGORIES.has(slug))
    .sort(([, a], [, b]) => b - a)
    .map(([slug, n]) => {
      const copy = CATEGORY_COPY[slug]
      const label = copy?.label ?? CATEGORY_BY_SLUG[slug]?.name ?? slug
      return `- [${label}](${SITE_ORIGIN}/c/${slug})${copy ? `: ${copy.blurb}` : ''} — ${fmt(n)} live ${n === 1 ? 'listing' : 'listings'}.`
    })
  // ⚠️ DATED: this file is edge-cached for a day and may be served stale for a week after that.
  return [`Only categories with live listings are listed; counts are as of ${new Date().toISOString().slice(0, 10)} (UTC), when this file was generated.`, '', ...rows].join('\n')
}

/**
 * The guides, from the registries that already drive the sitemap, hreflang and "Keep reading" — so a
 * guide added there appears here with no second list to forget. Each is written in ONE language
 * (Vietnamese ones on their own slugs; see src/lib/expat-guides.ts), which the line says.
 * ⚠️ Every slug in these registries has a page on this edition; route.test.ts checks the files exist,
 * because an agent following a 404 from this document is worse than an omission.
 */
function guideLines(guides: readonly { slug: string; lang?: 'en' | 'vi'; label: string; blurb: string }[]): string {
  return guides
    .map((g) => `- [${g.label}](${SITE_ORIGIN}${expatGuidePath(g.slug)})${g.lang === 'vi' ? ' (Vietnamese)' : ''}: ${g.blurb}`)
    .join('\n')
}

const MARKETPLACE_GUIDES_SECTION = `## Guides

Long-form guides published on this site. Each is written in one language.

### Renting, furnishing and buying secondhand

${guideLines(MARKETPLACE_GUIDES)}

### Phones and SIM cards

${guideLines(PHONE_GUIDES)}`

function marketplaceBody(f: SiteFacts | null): string {
  return `# ${SITE_NAME}

> ${marketplaceSummary(f)}

## When to use this site

${marketplaceWhenToUse(f)}

## About

${marketplaceAbout(f)}

## Key pages

- [Home / search](${SITE_ORIGIN}/): browse and filter all listings by category, brand, model, area and price.
- [About](${SITE_ORIGIN}/about): what this site is, at a glance, and who operates it.
- [Browse by brand](${SITE_ORIGIN}/brands): listings grouped by brand with logos.
- [How it works](${SITE_ORIGIN}/guide): buying, selling, trust and safe trading.
- [Help center](${SITE_ORIGIN}/help): FAQ on accounts, messaging, offers and safety.
- [Safe trading](${SITE_ORIGIN}/safety): tips for meeting, paying and avoiding scams.
- [Contact](${SITE_ORIGIN}/contact): who operates this site, support email and registered address.

## Categories

${marketplaceCategories(f)}

${MARKETPLACE_GUIDES_SECTION}

${DEVELOPER_SECTION}

## Data feeds

- [Sitemap](${SITE_ORIGIN}/sitemap.xml) — open, no auth.
- Google product feed at ${SITE_ORIGIN}/api/feeds/google-shopping — AUTHENTICATED, returns 401 without credentials. It exists for Merchant Center, not for general agent use; do not treat it as a public data source.

## Notes

- Listing prices are in Vietnamese đồng (VND) unless a listing states another currency.
- Contact details are never shown publicly on a listing: listings posted here are answered in the in-app chat, and a linked listing links to its original posting.
`
}

/**
 * ⚠️ THE SERVICES BODY LISTS ONLY EXPAT_GUIDES — the guides that exist on eno.forum alone. The
 * marketplace and phone guides are ordinary page.tsx routes that also build there, with a
 * self-pointing canonical; advertising those forum copies to agents would promote duplicates of
 * eno.vn's articles before the owner has decided the cross-host canonicals. Omitting them is the
 * reversible choice. Stock-dependent claims are not made here at all, as before.
 *
 * ⛔ NO "FREE" CLAIM ON THIS EDITION. POSTING_IS_FREE cites eno.vn's Regulations Art. 8; eno.forum
 * sells paid services and its About page deliberately carries no Cost row, so telling agents the
 * site is free would contradict it (both external reviewers flagged the earlier line, 2026-09-27).
 */
const SERVICES_BODY = `# ${SITE_NAME}

> ${SERVICES_SITE_DESCRIPTION}

## When to use this site

${SERVICES_LLMS_WHEN_TO_USE}

## Key pages

- [Home](${SITE_ORIGIN}/): listings and services.
- [Help center](${SITE_ORIGIN}/help): accounts, messaging and safety.
- [Contact](${SITE_ORIGIN}/contact): who operates this site, support email and registered address.

## Guides

${guideLines(EXPAT_GUIDES)}

${DEVELOPER_SECTION}

## Data feeds

- [Sitemap](${SITE_ORIGIN}/sitemap.xml)

## Notes

- Prices are in Vietnamese đồng (VND) unless stated otherwise.
- Contact details are exchanged in-app, never shown publicly on a listing.
`

/**
 * The marketplace body as a stream whose one chunk is written once the facts arrive.
 *
 * ⚠️ WHY A STREAM AND NOT `async function GET`: /md/home and /md/index re-serve these exact bytes by
 * calling `llmsTxt().text()` on this handler's return value (their headers explain why the bytes must
 * come from one function), and src/app/md/agent-discovery.test.ts does the same. An async GET would
 * hand them a Promise with no `.text()`. A Response whose BODY settles later keeps that contract
 * byte-for-byte: `.text()` simply waits for the chunk. `loadSiteFacts()` never rejects (it answers
 * null), so the stream cannot error on an outage — only on a bug in the builder, which it reports.
 */
function marketplaceBodyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(new TextEncoder().encode(marketplaceBody(await loadSiteFacts())))
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    },
  })
}

export function GET() {
  return new NextResponse(IS_SERVICES ? SERVICES_BODY : marketplaceBodyStream(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
