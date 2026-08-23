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
 * ⚠️ THE NARRATION STAYS IN THIS COMMENT AND OUT OF THE DOCUMENT. Everything in the template below
 * is SERVED to agents — a paragraph about our own audit history is noise in the one file whose job
 * is to tell a machine what this site offers. Facts an agent can act on go in the body; the reason
 * we added them goes here.
 */
const DEVELOPER_SECTION = `## For developers and agents

- [Developer documentation](${SITE_ORIGIN}/developers) — authentication, scopes, endpoints, copy-pasteable requests.
- [OpenAPI 3.1 spec](${SITE_ORIGIN}/openapi.json) — the Partner API, machine-readable. Also at ${SITE_ORIGIN}/api/v1/openapi.json.
- [OAuth authorization server metadata](${SITE_ORIGIN}/.well-known/oauth-authorization-server) — RFC 8414: token endpoint, grant, scopes.
- [OAuth protected resource metadata](${SITE_ORIGIN}/.well-known/oauth-protected-resource) — RFC 9728: which resource a token is for.
- [MCP Server Card](${SITE_ORIGIN}/.well-known/mcp.json) — the manifest for the hosted Model Context
  Protocol server: transport, supported protocol versions, and the header to connect with. The same
  document also answers at /.well-known/mcp-server-card.json and /.well-known/mcp/server-card.json.
- Hosted MCP server at ${SITE_ORIGIN}/api/mcp — an agent can manage a storefront directly, using an
  API key as the Bearer token. Streamable HTTP, stateless: JSON-RPC over POST, no SSE stream (a GET
  answers 405). Tools are listed at runtime via tools/list and each one is scope-gated.
- [Service status](${SITE_ORIGIN}/api/v1/status) — the one endpoint that needs NO credential. Returns
  the edition, the API version and links to the spec and the OAuth metadata, and carries live
  \`RateLimit\` headers so an agent can see the throttle before it has a key. Start here.
- ⚠️ Every OTHER operation is AUTHENTICATED, and needs either an \`eno_live_\` key or a token minted
  from one at ${SITE_ORIGIN}/api/v1/oauth/token (OAuth 2.0 client credentials). There is no sandbox
  and no test key. An agent without a key can read the spec, the metadata and /api/v1/status, but
  cannot call anything that touches a shop.
- Scopes: listings:read, listings:write, analytics:read, media:write. One key acts for one shop
  and only ever sees that shop's data.
- Keys are issued in the account dashboard, under Developers, to business accounts.`

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

${DEVELOPER_SECTION}

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

${DEVELOPER_SECTION}

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
