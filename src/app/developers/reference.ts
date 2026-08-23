import { OAUTH_ISSUER, OAUTH_SCOPES } from '@/lib/api/oauth'
import { SITE_NAME } from '@/lib/edition'
import { COMPANY } from '@/lib/site-legal'

/**
 * THE FACTS /developers STATES ABOUT ITSELF — extracted so the page and its test read the SAME
 * values, and so every one of them is DERIVED from the constant that already governs it rather
 * than retyped.
 *
 * ⛔ WHY THIS FILE EXISTS. Until 2026-08-23 page.tsx opened with a hardcoded
 * `const BASE = 'https://eno.vn/api/v1'`, and the page compiles into BOTH editions. Measured on
 * production that day: https://eno.forum/developers served `<title>API for developers |
 * eno.forum</title>` — the edition-aware half — above 49 occurrences of the string "eno.vn",
 * including the base URL and every single curl example. A forum partner who copy-pasted the
 * documented request sent their eno.forum traffic to eno.vn. The page was mis-branded and pointed
 * at the wrong catalogue.
 *
 * ⛔ AND THE FIRST DRAFT OF THIS COMMENT SAID SOMETHING FALSE ABOUT WHY THAT MATTERED — a reviewer
 * caught it. It claimed eno.vn is "a different deployment with a different database, which answers
 * 401 and cannot ever answer anything else". THE TWO EDITIONS SHARE ONE POSTGRES, and
 * `resolveApiKey` (src/lib/api/auth.ts) looks a key up by `hashedKey` alone, with no edition or
 * host predicate — so a forum key authenticates on eno.vn and always did. The harm was never a
 * 401; it was a partner silently operating against the wrong storefront while everything looked
 * fine. Do not act on the retracted version: in particular, do NOT assume cross-edition key reuse
 * is already prevented by the database, because it is not.
 *
 * This is the same leak class as the three already recorded elsewhere in this repo — the static
 * public/llms.txt that introduced eno.forum as eno.vn (see src/app/llms.txt/route.ts), the OpenAPI
 * spec whose `servers[0].url` pointed forum clients at eno.vn, and the OAuth `iss` that was
 * hardcoded on both editions (see OAUTH_ISSUER's note in src/lib/api/oauth.ts). Each was found by
 * curling the live domain, never by a gate, because none of them is a licensing violation that a
 * lint can name — they are the licensed marketplace's hostname appearing where THIS deployment's
 * hostname belonged.
 *
 * ⚠️ ORIGIN COMES FROM `OAUTH_ISSUER`, NOT FROM A FRESH `NEXT_PUBLIC_APP_URL` READ. Re-deriving it
 * would be correct today and free to drift tomorrow. The .well-known documents under
 * src/app/api/well-known/ already publish that exact constant, and a developer page that named a
 * different host than the discovery document a client machine-reads is the contradiction most
 * expensive to debug: the human followed the docs, the agent followed the metadata, and they
 * ended up on two different servers. One import makes them the same value by construction.
 */

/** This deployment's own origin — https://eno.vn or https://www.eno.forum. No trailing slash. */
export const SITE_ORIGIN = OAUTH_ISSUER

/** Where every documented request goes. Matches the OpenAPI `servers[0].url` and RFC 9728 `resource`. */
export const API_BASE = `${OAUTH_ISSUER}/api/v1`

/** Product name for the <title> and <h1>. Derived — never the literal "eno.vn". */
export const API_NAME = `${SITE_NAME} Partner API`

/** Support inbox for this edition (support@eno.vn / support@eno.forum). */
export const SUPPORT_EMAIL = COMPANY.email

/**
 * The four scopes, from the constant the token endpoint enforces and both .well-known documents
 * advertise. Retyping them here is how a fifth scope ships undocumented, or a renamed one keeps
 * being documented after it stops working.
 */
export const SCOPES = OAUTH_SCOPES

/**
 * ⚠️ EVERY ENTRY WAS CURLED AGAINST BOTH LIVE DEPLOYMENTS ON 2026-08-23 BEFORE BEING WRITTEN DOWN.
 * A developer page is a promise to a machine: an agent reads these hrefs and fetches them without
 * a human in the loop, so a plausible-but-404 URL here costs more than an omission. Results —
 * identical status and content-type on eno.vn and eno.forum:
 *
 *   /openapi.json                                200 application/json
 *   /api/v1/openapi.json                         200 application/json
 *   /llms.txt                                    200 text/plain
 *   /.well-known/oauth-authorization-server      200 application/json
 *   /.well-known/oauth-protected-resource        200 application/json
 *   /sitemap.xml                                 200 application/xml
 *
 * These are ROOT-RELATIVE on purpose. The page is served from this origin, so a relative href
 * resolves to this deployment's copy — which is the whole point, and one fewer place for a
 * hostname to be wrong. It also means a preview or a native WebView following these links stays
 * where it started.
 *
 * ⚠️ NO SANDBOX AND NO FREE-TIER ENTRY, DELIBERATELY. Neither exists. There is one key type
 * (`eno_live_`), it acts on real data in the real shop, and there is no `eno_test_` namespace to
 * point anyone at. Listing a sandbox that a partner then cannot find is worse than saying nothing.
 */
/**
 * Where uploaded media is served from. DERIVED, never a literal — the same rule as every other
 * value in this file.
 * ⚠️ The page used to print a `…supabase.co/…` URL shape here, which is the RETIRED Supabase Cloud
 * project; media has come off the self-hosted stack since the 2026-08-22 cutover. A partner copying
 * that shape would build the wrong URL. next.config.ts now THROWS at build time when this env is
 * missing, so the `?? ''` below is unreachable in any real build and exists only to keep the type
 * honest.
 */
export const MEDIA_ORIGIN = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin }
  catch { return '' }
})()

export const DISCOVERY: ReadonlyArray<{ href: string; label: string; note: string }> = [
  {
    href: '/api/v1/status',
    label: '/api/v1/status',
    note: 'The only endpoint that needs no credential. Edition, API version, links to everything below — and live RateLimit headers, so you can see the throttle before you have a key. Start here.',
  },
  {
    href: '/openapi.json',
    label: '/openapi.json',
    note: 'OpenAPI 3.1 description of every endpoint below — point a codegen or an agent at this first.',
  },
  {
    href: '/api/v1/openapi.json',
    label: '/api/v1/openapi.json',
    note: 'The same document at its original path, kept because partner codegen configs already reference it.',
  },
  {
    href: '/.well-known/oauth-authorization-server',
    label: '/.well-known/oauth-authorization-server',
    note: 'RFC 8414 metadata: the token endpoint, the supported grant, and the scope list.',
  },
  {
    href: '/.well-known/oauth-protected-resource',
    label: '/.well-known/oauth-protected-resource',
    note: 'RFC 9728 metadata: which resource the token is for, and which server issues it. An agent that gets a 401 reads this to find its way in.',
  },
  {
    href: '/llms.txt',
    label: '/llms.txt',
    note: 'What this site is and when to use it, written for an agent rather than a crawler.',
  },
  {
    href: '/sitemap.xml',
    label: '/sitemap.xml',
    note: 'Every public URL. Open, no credentials.',
  },
]
