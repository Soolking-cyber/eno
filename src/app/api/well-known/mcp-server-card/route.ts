import { NextRequest, NextResponse } from 'next/server'
import { OAUTH_ISSUER, OAUTH_SCOPES } from '@/lib/api/oauth'
import { SITE_NAME } from '@/lib/edition'

/**
 * ── MCP Server Card — the discovery document for the MCP server we ALREADY RUN ────────────────
 *
 * ⛔ THIS CREATES NO SERVER. `src/app/api/mcp/route.ts` has been live since the partner API's
 * Phase 4: a stateless Streamable-HTTP MCP server, key-authed by `resolveApiKey`, wrapping the same
 * shop-scoped cores as /api/v1. Measured against production on 2026-08-23, before a line of this
 * file was written:
 *
 *     GET  https://eno.vn/api/mcp                    → 405 application/json, `Allow: POST, OPTIONS`
 *     POST https://eno.vn/api/mcp  (no credential)   → 401 application/json, `WWW-Authenticate: Bearer`
 *     OPTIONS                                        → 204 with the CORS preflight headers
 *     GET  /.well-known/mcp.json                     → 404
 *     GET  /.well-known/mcp-server-card.json         → 404
 *     GET  /.well-known/mcp/server-card.json         → 404
 *
 * So the server answered correctly and NOTHING pointed at it. That is the whole defect: the same
 * agent audit that read the API as having no OAuth (fixed by the two sibling documents in this
 * directory) had no way to learn the MCP endpoint exists. nginx's access log for the 2026-08-23
 * 11:39Z scan window shows it guessing — 21 hits on /.well-known/ai-catalog.json, 15 each on
 * mcp.json, mcp-server-card.json and mcp/server-card.json, all 404 — while it was simultaneously
 * issuing `GET /api/mcp` seven times and getting the 405 above.
 *
 * ⚠️ HOW MUCH OF THIS IS ACTUALLY STANDARDISED — READ BEFORE "CORRECTING" ANY FIELD.
 * The Server Card is NOT in the MCP specification. The current revision is 2026-07-28 and its only
 * discovery mechanism is the `server/discover` JSON-RPC method — a RUNTIME call, which by
 * definition cannot solve pre-connection discovery. The static card lives in two open proposals:
 *
 *   · SEP-2127 (Draft, champion @dsp-ant/Anthropic) — the document shape used below.
 *   · SEP-1649 — the same idea, proposing `/.well-known/mcp/server-card.json`.
 *
 * Neither is merged. The shape here is taken from the Server Card WG's own experimental extension,
 * `modelcontextprotocol/experimental-ext-server-card` (schema.ts + docs/discovery.md, read
 * 2026-08-23) — that repository is the closest thing to a normative source that exists today, and
 * it is what SEP-2127 links to. Every field below is one it defines; nothing is invented.
 *
 * ⛔ THE WG EXPLICITLY DOES *NOT* RECOMMEND `.well-known` FOR A SERVER CARD, AND WE SERVE IT THERE
 * ANYWAY — DELIBERATELY. docs/discovery.md "Alternatives considered" rejects `.well-known` because
 * a single server's card is application-level rather than site-wide metadata, and reserves
 * `GET <streamable-http-url>/server-card` (i.e. /api/mcp/server-card) instead. But: a card "MAY be
 * hosted at any unreserved URI", the reserved location is a MAY not a MUST, and the paths real
 * scanners fetch today are the `.well-known` ones — measured above, sixty-six times in one scan
 * window. Publishing where the client actually looks is worth more than publishing only where the
 * draft prefers, and the two are not in conflict. See `notes` for the /api/mcp/server-card
 * follow-up, which needs a change to src/proxy.ts that this file may not make.
 *
 * ⚠️ ONE HANDLER, FIVE PATHS, BY REWRITE. next.config.ts maps every probed spelling to this route,
 * for the same reason the OAuth pair is rewritten rather than duplicated: three copies of a
 * manifest are three documents that drift, and the drift is invisible because each one parses.
 * The route lives under /api/well-known/ because the app router ignores dot-folders and
 * public/.well-known/ cannot read the edition — the exact trap that had eno.forum serving eno.vn's
 * llms.txt (see src/app/llms.txt/route.ts).
 *
 * ⛔ EVERY FIELD IS TRUE OF THE ROUTE, AND THE OMISSIONS ARE THE LOAD-BEARING PART. A manifest that
 * advertises a transport or a tool the server does not implement is worse than no manifest: the
 * agent connects, fails, and cannot tell whose fault it is. What is deliberately NOT here:
 *   · NO tool list. The WG omits primitives from the card ON PURPOSE — tools/list is the
 *     authority, and a static copy of fifteen tool schemas is a drift generator. `tools/call` is
 *     also scope-gated per tool, so a card-level list would advertise calls a given key cannot make.
 *   · NO `sse` remote. The route has no server-initiated stream: GET answers 405 with
 *     `Allow: POST, OPTIONS`, which is precisely what Streamable HTTP prescribes for a server that
 *     does not offer one. Listing "sse" would send clients to that 405.
 *   · NO `icons`. `public/` is copied into BOTH builds verbatim, so no asset under it can be
 *     edition-correct — the same reason llms.txt had to stop being a static file. An icon that is
 *     right for one edition is a mis-branding on the other, and the field is optional.
 *   · NO `repository`. Optional, and pointing a discovery document at source is a decision about
 *     the licensed company's disclosure posture, not a technical default.
 *
 * ⛔ EVERY SELF-NAMING VALUE IS DERIVED — this file compiles into BOTH editions. `OAUTH_ISSUER` is
 * imported rather than rebuilt so the card, the RFC 8414/9728 documents, the OpenAPI `servers[0]`
 * and the `iss` we mint are one value by construction. A literal 'eno.vn' here would be the fifth
 * shipment of that leak class (static llms.txt, the OpenAPI title, /developers, an ApiStatus
 * description were the first four).
 */

export const runtime = 'nodejs'

/**
 * Reverse-DNS namespace for this deployment: eno.vn → `vn.eno`, eno.forum → `forum.eno`.
 * ⚠️ DERIVED FROM SITE_NAME, NOT FROM `new URL(OAUTH_ISSUER).host`. The services edition's origin is
 * https://www.eno.forum, so the host route yields `forum.eno.www` — a `www` label baked into a
 * stable server identity, which is exactly the kind of thing that later cannot be changed without
 * breaking whoever pinned it. SITE_NAME is the edition's identity with no transport artefacts.
 */
const RDNS = SITE_NAME.split('.').reverse().join('.')

/**
 * ⛔ PINNED TO `serverInfo.version` IN src/app/api/mcp/route.ts. docs/discovery.md's "Consistency
 * with Runtime Behavior" is normative: the `serverInfo` a client observes after connecting SHOULD
 * NOT contradict the card it read before connecting. route.ts is not importable from here (it is a
 * route module, and Next rejects non-handler exports), so route.test.ts asserts the two agree by
 * reading route.ts's source. Bump both together or the test fails.
 */
const SERVER_VERSION = '1.0.0'

/**
 * ⛔ THE THREE VALUES IN `SUPPORTED` IN route.ts, IN ITS ORDER, NEWEST FIRST. `initialize` echoes
 * the client's requested version when it is in this set and otherwise falls back to 2025-06-18.
 * ⚠️ THIS IS NOT THE LATEST MCP REVISION AND MUST NOT BE "UPDATED" HERE. The spec is at 2026-07-28;
 * our server does not implement it, and advertising it would make a conforming client negotiate a
 * version the server then silently downgrades. Add it here only after route.ts speaks it.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

function serverCard() {
  return {
    /**
     * ⚠️ REQUIRED, AND THE SCHEMA PINS IT TO THIS EXACT STRING (`@pattern` on ServerCard.$schema in
     * the WG's schema.ts). It is a version IDENTIFIER, not a fetch target — and as of 2026-08-23 it
     * 404s, verified by curl. That is upstream's, not ours: the `v1` family is named before it is
     * published. Do not "fix" it to a URL that resolves; a client validating the card compares this
     * string.
     */
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    /** Reverse-DNS, exactly one slash — `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`. */
    name: `${RDNS}/partner-api`,
    version: SERVER_VERSION,
    /**
     * ⚠️ HARD CAP OF 100 CHARACTERS in the schema, and it names no host on purpose: this one
     * sentence is identical on both editions, so there is nothing here that can be the wrong
     * domain. The identity lives in `name` and `title`, both derived. It also names no visa,
     * itinerary or PayPal surface — this document ships in the LICENSED marketplace build.
     */
    description: 'Manage one storefront: listings, bulk catalogue sync, analytics and webhooks.',
    title: `${SITE_NAME} Partner API`,
    websiteUrl: `${OAUTH_ISSUER}/developers`,
    remotes: [
      {
        /**
         * ⛔ "streamable-http" IS THE TRUTH, NOT AN APPROXIMATION, AND IT IS WORTH SPELLING OUT
         * BECAUSE THE ROUTE LOOKS LIKE "JUST JSON-RPC OVER POST". Streamable HTTP lets a server
         * answer a POST with either `text/event-stream` or `application/json`, and makes the SSE
         * GET optional — a server that does not offer one MUST answer 405, which is exactly what
         * route.ts does, `Allow: POST, OPTIONS` and all. Sessions are optional too, and this server
         * is deliberately stateless (it accepts `Mcp-Session-Id` in CORS but issues none). So it is
         * a conformant Streamable-HTTP server that happens never to stream.
         */
        type: 'streamable-http',
        url: `${OAUTH_ISSUER}/api/mcp`,
        supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
        /**
         * ⛔ THE CREDENTIAL IS A CONNECTION HEADER, NEVER A TOOL ARGUMENT — that is the security
         * property this whole surface is built on (see the header comment in src/lib/mcp/tools.ts).
         * Modelling it as a KeyValueInput with a `{api_key}` variable is what lets a client PROMPT
         * for it and store it in connection config, so the model never sees it. `isSecret` is what
         * tells the client to mask and not to log it.
         *
         * ⚠️ BOTH CREDENTIAL FORMS FIT THIS ONE HEADER, WHICH IS WHY THERE IS ONLY ONE ENTRY.
         * resolveApiKey accepts a raw `eno_live_…`/`eno_test_…` key OR an HS256 access token minted
         * from one at /api/v1/oauth/token, on the SAME `Authorization: Bearer` header and nothing
         * else — no query parameter, no form field (see the RFC 9728 document's
         * `bearer_methods_supported: ['header']`). The placeholder shows the key form because that
         * is the one a partner holds; the token form is documented at the OAuth metadata URL in
         * `_meta` below.
         */
        headers: [
          {
            name: 'Authorization',
            description: 'Bearer credential for one shop. Sent by the client on every request; never passed to the model.',
            isRequired: true,
            isSecret: true,
            value: 'Bearer {api_key}',
            variables: {
              api_key: {
                description: `Partner API key, issued in the ${SITE_NAME} dashboard under Developers. An OAuth 2.0 access token from /api/v1/oauth/token works here too.`,
                isRequired: true,
                isSecret: true,
                format: 'string',
                placeholder: 'eno_live_…',
              },
            },
          },
        ],
      },
    ],
    /**
     * ⚠️ `_meta` IS WHERE AUTHORIZATION GOES, BECAUSE THE CARD SCHEMA HAS NO FIELD FOR IT. A client
     * that connects and gets the 401 measured above needs to find the authorization server; RFC
     * 9728 is how, and this saves it the round trip. Reverse-DNS prefix per the `_meta` key rules —
     * `vn.eno/` is unreserved (anything ending in `mcp` or `modelcontextprotocol` is not).
     * The scope list is `OAUTH_SCOPES`, the same constant the token endpoint enforces and both
     * .well-known OAuth documents publish, so a client cannot be shown three different scope sets.
     */
    _meta: {
      [`${RDNS}/partner-api`]: {
        authorizationServer: OAUTH_ISSUER,
        protectedResourceMetadata: `${OAUTH_ISSUER}/.well-known/oauth-protected-resource`,
        authorizationServerMetadata: `${OAUTH_ISSUER}/.well-known/oauth-authorization-server`,
        scopes: [...OAUTH_SCOPES],
        documentation: `${OAUTH_ISSUER}/developers`,
      },
    },
  }
}

/** The media type the Server Card spec defines. */
const CARD_TYPE = 'application/mcp-server-card+json'

/**
 * ⚠️ CORS IS A MUST FOR A HOSTED CARD (docs/discovery.md, "CORS Requirements") — browser-based MCP
 * clients read this cross-origin. Safe by construction: the document is public, read-only metadata
 * and carries no credential. `If-None-Match`/`ETag` are in the spec's list; we do not mint an ETag
 * today, so exposing it is a harmless no-op rather than a promise.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag',
}

export function GET(req: NextRequest) {
  /**
   * ⛔ CONTENT NEGOTIATION, AND IT IS NOT DECORATION — TWO POPULATIONS READ THIS ONE DOCUMENT.
   * A spec-conformant MCP client SHOULD send `Accept: application/mcp-server-card+json` and the
   * server SHOULD echo the negotiated type. An audit scanner fetching /.well-known/mcp.json sends
   * `Accept` with a wildcard and some of them check for `application/json` literally. The BYTES are identical
   * either way; only the label moves, so neither population can be misled by the other's answer.
   *
   * ⚠️ A SHARED CACHE MAY STILL HAND ONE POPULATION THE OTHER'S CONTENT-TYPE, AND THAT IS HARMLESS
   * HERE — but do NOT justify it the way the first draft of this comment did.
   * ⛔ IT SAID "CF's cache key does not include Accept (it honours Vary for Accept-Encoding and
   * essentially nothing else)". THAT IS MEASURED FALSE ON THESE ZONES, and src/app/md/markdown-response.ts
   * records the measurement and explicitly forbids restoring the claim: read from the Cloudflare API
   * on 2026-08-23, the live cache rule on / , /privacy and /terms carries
   * `"vary": {"default": {"action": "normalize"}}` — Vary handling is explicitly ON. Repeating the
   * false version here would have re-armed the reasoning that nearly shipped a fragmented homepage cache.
   * What actually makes this safe is narrower and does not depend on Cloudflare at all: the BYTES are
   * identical either way, so only the label can move. A `+json` suffix parses as JSON and a client that
   * asked for the card type still gets valid JSON, which is why negotiating here is safe where
   * negotiating a DIFFERENT BODY would not be.
   */
  // ⚠️ NOT a bare `.includes()`. `Accept: application/json, application/mcp-server-card+json;q=0`
  // explicitly REFUSES the card type, and a substring test hands it over anyway — the same defect
  // codex caught in the markdown matcher in next.config.ts, where it now has 18 header cases
  // behind it. RFC 9110 §12.4.2: q=0 means "not acceptable".
  const accept = req.headers.get('accept') || ''
  const refusedWithQ0 = new RegExp(
    `${CARD_TYPE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^,]*;\\s*q\\s*=\\s*0(?:\\.0*)?(?![0-9.])`,
    'i',
  ).test(accept)
  const wantsCard = accept.includes(CARD_TYPE) && !refusedWithQ0
  return NextResponse.json(serverCard(), {
    headers: {
      'Content-Type': `${wantsCard ? CARD_TYPE : 'application/json'}; charset=utf-8`,
      Vary: 'Accept',
      // Build-constant public metadata. An hour matches the sibling OAuth documents and the
      // spec's own recommendation.
      'Cache-Control': 'public, max-age=3600',
      ...CORS,
    },
  })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}
