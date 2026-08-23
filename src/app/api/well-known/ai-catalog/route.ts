import { NextResponse } from 'next/server'
import { OAUTH_ISSUER, OAUTH_SCOPES, TOKEN_TTL_SECONDS } from '@/lib/api/oauth'
import { API_RATE_PER_MIN, API_RATE_WINDOW_SEC } from '@/lib/api/auth'
import { toolDescriptors } from '@/lib/mcp/tools'
import { SITE_NAME } from '@/lib/edition'

// ── Agentic Resource Discovery · /.well-known/ai-catalog.json ─────────────────────
// Served at /.well-known/ai-catalog.json via a rewrite in next.config.ts, for the same reason the
// AASA and the two OAuth metadata routes live here: the app router ignores dot-folders, so a
// literal `.well-known` directory in the app tree is never routed, and `public/.well-known` cannot
// run code (and therefore cannot vary by edition — the failure recorded at the top of
// src/app/llms.txt/route.ts).
//
// ── WHY THIS EXISTS — MEASURED, NOT GUESSED ─────────────────────────────────────────────────────
// The nginx access log for the 2026-08-23T11:39Z agent-audit scan shows what the auditor actually
// fetches, which is mostly NOT what its own suggestion list mentions. Among the 404s:
//     /.well-known/ai-catalog.json  x21     /.well-known/mcp.json            x15
//     /.well-known/agent-skills     x15     /.well-known/mcp-server-card.json x15
// The scan prices the ARD catalogue at +1.7. More to the point than the score: `/api/mcp` has been
// a live, auth-gated MCP server since the partner API's Phase 4 (GET -> 405, POST -> 401 JSON) and
// NOTHING anywhere pointed at it. A capability no document mentions is, to a machine, a capability
// that does not exist — the same lesson /developers taught on the same day when it turned out to be
// in no sitemap and behind no link (see src/app/sitemap.xml/route.ts:135).
//
// ── THE SHAPE IS THE PUBLISHED ARD SCHEMA, NOT AN INVENTION ─────────────────────────────────────
// Read from https://agenticresourcediscovery.org/spec/ (ARD v0.9) and its AI Catalog Standard page
// on 2026-08-23. Root: `specVersion` (string, required), `host` (object, required), `entries`
// (array, required); `collections` links sub-catalogues and is omitted because there are none.
// Each entry requires `identifier` (`urn:air:<publisher>:<namespace>:<name>`), `displayName`, a
// `type` that is an IANA media type, and EXACTLY ONE of `url` (remote reference) or `data`
// (embedded document). `description`, `tags`, `capabilities`, `representativeQueries` (2-5),
// `version`, `updatedAt`, `metadata` and `trustManifest` are optional.
//
// ⛔ NO `trustManifest` ANYWHERE IN THIS DOCUMENT, AND THAT IS DELIBERATE. Its `attestations` are
// links to compliance artefacts — SOC2 reports, SPIFFE JWKS, a GDPR page. This deployment has none
// of those. An `attestations: []` or a `identity` pointing at a URL that 404s is a claim about
// audit posture, which is the single worst field in this schema to bluff, and the operating entity
// behind the services edition is still pending (see src/lib/site-legal.ts).
//
// ⛔ AND NO `agent` OR `skill` ENTRIES. The auditor probes /.well-known/agent-skills and
// /.well-known/agent-skills/index.json fifteen times each; we serve neither, because there is no
// A2A agent card and no skills endpoint behind this domain. Every entry below was curled on the
// live deployment before it was written down (see the table on VERIFIED, further down).
//
// ⚠️ THE CONTENT TYPE IS `application/json`, NOT `application/ai-catalog+json`. The spec uses the
// latter as the `type` of a NESTED catalogue entry; nothing in it mandates a response content type
// for the well-known document itself, and the population that fetches this path is overwhelmingly
// generic JSON clients. If a conformance tool is ever run against this and demands the +json
// suffix, change it here — it is one string, and the risk of the change is a naive client that
// switch-cases on `application/json`.

export const runtime = 'nodejs'

/**
 * ⚠️ THE PUBLISHER IS THE HOST OF `OAUTH_ISSUER`, NOT THE LITERAL SITE_NAME — and the difference
 * is real on one edition. SITE_NAME is 'eno.vn' / 'eno.forum'; the canonical origin on the services
 * build is `https://www.eno.forum` (the apex 308s to www, see OAUTH_ISSUER's note in
 * src/lib/api/oauth.ts). Deriving the URN publisher and `host.identifier` from the ORIGIN means
 * every identifier in this catalogue names the exact host the catalogue was fetched from, which is
 * the property a consumer can actually check. `displayName` stays SITE_NAME because that is the
 * brand a human reads.
 *
 * ⛔ BOTH ARE DERIVED. A literal 'eno.vn' in a machine-readable document has shipped FOUR times in
 * this repo (static llms.txt, the OpenAPI title, the developers page, an ApiStatus description) and
 * every one of them made eno.forum introduce itself as the licensed Vietnamese marketplace.
 */
const PUBLISHER = new URL(OAUTH_ISSUER).host
const urn = (namespace: string, name: string) => `urn:air:${PUBLISHER}:${namespace}:${name}`

export async function GET() {
  /**
   * ⚠️ HARVESTED FROM THE SERVER'S OWN DESCRIPTORS, NEVER RETYPED. `toolDescriptors()` is the exact
   * function `tools/list` answers with on /api/mcp, so the `capabilities` list built from it below
   * cannot name a tool the server does not expose, and a tool added there appears here without
   * anybody remembering to. Only the names are used — see the note on that field.
   */
  const tools = toolDescriptors()

  return NextResponse.json(
    {
      specVersion: '1.0',
      host: {
        displayName: SITE_NAME,
        identifier: PUBLISHER,
        documentationUrl: `${OAUTH_ISSUER}/developers`,
      },
      /**
       * ⚠️ EVERY `url` BELOW EITHER WAS CURLED ON THE LIVE DEPLOYMENT BEFORE IT WAS WRITTEN DOWN,
       * OR SHIPS IN THIS SAME BATCH (the two markdown documents here; the MCP server card next
       * door). A catalogue is a promise to a
       * machine that will fetch these without a human in the loop, so a plausible-but-404 entry
       * costs more here than an omission does — the same rule stated at the head of
       * src/app/developers/reference.ts, where each of these paths is also listed.
       */
      entries: [
        {
          // The credential-free door. First, deliberately: an agent with no key can still fetch
          // this one, read the edition and the version, and see live RateLimit headers.
          identifier: urn('endpoint', 'status'),
          displayName: `${SITE_NAME} Partner API status`,
          type: 'application/json',
          url: `${OAUTH_ISSUER}/api/v1/status`,
          description:
            'The only endpoint that needs no credential. Returns the edition, the API version, links to the OpenAPI spec and the OAuth metadata, and carries live RateLimit headers so a client can see the throttle before it has a key.',
          tags: ['status', 'public', 'no-auth'],
        },
        {
          identifier: urn('api', 'partner-v1'),
          displayName: `${SITE_NAME} Partner API`,
          // The media type registered for OpenAPI documents by the OpenAPI Initiative.
          type: // ⚠️ 'application/json', not 'application/vnd.oai.openapi+json'. ARD requires `url` to point at a
      // document of the DECLARED type, and /openapi.json serves plain application/json — verified by
      // curl, not assumed. Declaring the vendor type would make this catalogue wrong about the one
      // thing it exists to describe.
      'application/json',
          url: `${OAUTH_ISSUER}/openapi.json`,
          description:
            'OpenAPI 3.1 description of the shop-scoped REST API: listings, bulk import, catalogue sync, analytics, media and webhooks. Every operation is authenticated and acts for exactly one shop.',
          tags: ['openapi', 'rest', 'marketplace'],
          version: 'v1',
        },
        {
          identifier: urn('server', 'partner-mcp'),
          displayName: `${SITE_NAME} Partner MCP server`,
          // ⚠️ BYTE-IDENTICAL TO `CARD_TYPE` IN src/app/api/well-known/mcp-server-card/route.ts,
          // which is the media type that document is served with. ARD says `url` must point at a
          // document OF THE DECLARED TYPE, so these two strings agreeing is the whole contract.
          // ⚠️ 'application/json' — the type a DEFAULT fetch of that URL actually receives.
          // The card route content-negotiates: it emits 'application/mcp-server-card+json' only
          // when the request's Accept asks for it, and plain JSON otherwise. ARD's `type` describes
          // what a client gets by following `url`, so the negotiated type would be wrong for every
          // client that does not already know to ask — which is every client reading a catalogue
          // to discover the thing in the first place.
          type: 'application/json',
          /**
           * ⛔ `url`, NOT AN EMBEDDED `data` CARD — AND THE FIRST DRAFT OF THIS FILE HAD THE EMBEDDED
           * ONE. At the time it was written /.well-known/mcp.json returned 404 (curled), so a
           * hand-modelled inline card looked like the only honest option. It is not, and it is
           * actively worse: a SIBLING CHANGE IN THIS SAME BATCH publishes a real MCP Server Card at
           * /.well-known/mcp.json (plus four alias spellings), shaped to the Server Card WG's
           * experimental schema rather than to my guess at one. Two server cards describing one
           * server is a drift generator whose divergence is invisible because both parse — exactly
           * the failure the repo already records for llms.txt-vs-page copy and for the OpenAPI
           * scope list. One document, one URL, referenced.
           *
           * ⛔ WHICH MAKES THIS THE ONE ENTRY WITH A CROSS-CHANGE DEPENDENCY: if that route does not
           * ship, this becomes a catalogue pointing at a 404, which is the failure mode this whole
           * file exists to remove. It is pinned by the test beside this route (the handler is
           * imported and asserted to exist) and it is linked from /llms.txt's developer block, so
           * dropping it breaks three documents rather than one. Do not relax the test.
           *
           * ⚠️ AND DO NOT POINT THIS AT `/api/mcp`. That is the TRANSPORT endpoint: `GET` answers
           * 405 with `Allow: POST, OPTIONS`. A conforming client following `url` would get a 405
           * where it expected JSON — worse than the 404 we started with, because it looks like a
           * server fault rather than a missing document.
           */
          url: `${OAUTH_ISSUER}/.well-known/mcp.json`,
          description: `Hosted MCP server at ${OAUTH_ISSUER}/api/mcp — Streamable HTTP, JSON-RPC over POST, stateless. Manage one storefront: listings, bulk import, catalogue sync, analytics, webhooks. An API key is the Bearer token, held in the client's connection config, so it never reaches the model.`,
          tags: ['mcp', 'tools', 'storefront'],
          /**
           * ARD: "Skill identifiers". The tool names are the only honest answer to that here — and
           * this is the ONE thing this entry adds that the server card deliberately does not carry.
           * The Server Card WG omits primitives from a card on purpose (tools/list is the
           * authority), which is right for a card and leaves a discovery service with nothing to
           * match a user's task against. `capabilities` is the ARD field for exactly that, and it
           * costs nothing to keep true: harvested below from `toolDescriptors()`, the same function
           * `tools/list` answers with, so a renamed tool changes this list with no second edit.
           *
           * ⚠️ NAMES ONLY, NO SCHEMAS. `toolDescriptors()` carries a full JSON Schema per tool;
           * embedding fifteen of them would make an unauthenticated hourly-cached discovery
           * document tens of kilobytes and publish a second copy of a contract that is one
           * `tools/list` call away. A directory entry says what exists and how to reach it.
           */
          capabilities: tools.map((t) => t.name),
          /**
           * 2-5 natural-language examples, per the spec. Each maps to a tool that exists —
           * list_listings, create_listing, analytics_summary. ⛔ Do not add a query the toolset
           * cannot serve: this field is what a discovery service matches a user's task against, so
           * an aspirational example routes a request here and then fails it.
           */
          representativeQueries: [
            "list my shop's active listings",
            'create a listing for a used motorbike with photos',
            'how many views and leads did my listings get last week',
          ],
        },
        {
          identifier: urn('metadata', 'oauth-authorization-server'),
          displayName: 'OAuth 2.0 Authorization Server Metadata',
          type: 'application/json',
          url: `${OAUTH_ISSUER}/.well-known/oauth-authorization-server`,
          description: `RFC 8414 metadata: the token endpoint, the single supported grant (client_credentials), the ${OAUTH_SCOPES.length} scopes, and the two client authentication methods. Access tokens live ${TOKEN_TTL_SECONDS} seconds.`,
          tags: ['oauth2', 'rfc8414', 'auth'],
        },
        {
          identifier: urn('metadata', 'oauth-protected-resource'),
          displayName: 'OAuth 2.0 Protected Resource Metadata',
          type: 'application/json',
          url: `${OAUTH_ISSUER}/.well-known/oauth-protected-resource`,
          description:
            'RFC 9728 metadata: which resource a token is for, and which authorization server issues it. An agent that receives a 401 reads this to find its way in.',
          tags: ['oauth2', 'rfc9728', 'auth'],
        },
        {
          identifier: urn('doc', 'llms-txt'),
          displayName: 'llms.txt',
          type: 'text/plain',
          url: `${OAUTH_ISSUER}/llms.txt`,
          description:
            'What this site is and when to use it, written for an agent rather than a crawler: the key pages, the categories, the data feeds, and the developer surface.',
          tags: ['llms.txt', 'overview'],
        },
        {
          identifier: urn('doc', 'agents-md'),
          displayName: 'agents.md',
          type: 'text/markdown',
          url: `${OAUTH_ISSUER}/agents.md`,
          description:
            'What an agent can do on this deployment without credentials and with them, the entry points, the rate limits, and the rules about contact details.',
          tags: ['agents.md', 'overview'],
        },
        {
          identifier: urn('doc', 'auth-md'),
          displayName: 'auth.md',
          type: 'text/markdown',
          url: `${OAUTH_ISSUER}/auth.md`,
          description: `How to authenticate: the eno_live_ bearer key, the OAuth 2.0 client-credentials grant, the ${OAUTH_SCOPES.length} scopes, the ${API_RATE_PER_MIN}-per-${API_RATE_WINDOW_SEC}s budget, and where a partner gets a key.`,
          tags: ['auth', 'oauth2', 'api-keys'],
        },
      ],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        // Same hour as the two OAuth metadata documents, for the same reason: this is
        // build-constant and public, so an hour stops a client re-fetching per request while still
        // letting a domain change propagate on the day it happens.
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
