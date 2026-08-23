import { NextResponse } from 'next/server'
import { SITE_NAME } from '@/lib/edition'
import { OAUTH_SCOPES } from '@/lib/api/oauth'

// ⚠️ SAME DERIVATION AS layout.tsx, llms.txt AND src/lib/api/oauth.ts. next.config.ts asserts
// NEXT_PUBLIC_APP_URL matches the edition (`eno.vn` for marketplace, `www.eno.forum` for
// services), so this is the one value guaranteed to describe THIS deployment.
//
// ⚠️ THE FALLBACK IS `https://${SITE_NAME}`, NOT THE OLD `'https://eno.vn'` LITERAL. The literal
// named the LICENSED marketplace on a forum build whenever the env var was absent (local vitest, a
// pre-Phase-1 image) — the same leak class edition.ts exists to prevent, and the same one that put
// `servers: https://eno.vn/api/v1` in the spec eno.forum served. oauth.ts already derives it this
// way and the two documents MUST agree: the `iss` of a token and the `tokenUrl` describing it are
// read by the same client.
const CANONICAL_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`).replace(/\/+$/, '')

/**
 * The OTHER host this same deployment answers on: apex ⇄ www.
 *
 * ⛔ WHY A SECOND `servers` ENTRY IS NOT PADDING. An agent audit on 2026-08-23 reported
 * "No OpenAPI specification found" for eno.forum while a complete spec was being served — the
 * scanner probes the APEX (`eno.forum`) and the spec declared only `https://www.eno.forum/api/v1`,
 * so every URL a tool derived from the document pointed at a host the tool had not been asked
 * about. Both hosts genuinely reach this app (measured 2026-08-23: all four of eno.vn,
 * www.eno.vn, eno.forum and www.eno.forum resolve to the same Cloudflare pair in front of the same
 * Cloud Run service), and a 308 preserves method and body, so a client that follows redirects gets
 * an identical result from either. Declaring both is describing reality; declaring one is why a
 * scanner concluded the API did not exist.
 *
 * ⚠️ CANONICAL STAYS FIRST. `servers[0]` is what most codegen uses as the default base URL, and
 * route.test.ts pins it per edition. The non-canonical entry is labelled as a redirect rather than
 * presented as an equal peer, because a client that does NOT follow redirects must be able to tell
 * which one to pick.
 *
 * Returns null for hosts where the www⇄apex pair is meaningless (localhost, a bare IP) so a dev
 * build does not advertise `https://www.localhost`.
 */
function alternateOrigin(origin: string): string | null {
  try {
    const u = new URL(origin)
    if (u.hostname === 'localhost' || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null
    u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`
    return u.origin
  } catch {
    return null
  }
}
const ALT_ORIGIN = alternateOrigin(CANONICAL_ORIGIN)

const CANONICAL_SERVER = {
  url: `${CANONICAL_ORIGIN}/api/v1`,
  description: 'Canonical origin for this deployment. Prefer this one.',
} as const

/**
 * ⚠️ A UNION OF TWO TUPLES RATHER THAN A CONDITIONAL SPREAD, so `servers[0]` stays a known element
 * in both branches and route.test.ts can index it without a non-null assertion.
 */
const SERVERS = ALT_ORIGIN
  ? ([
      CANONICAL_SERVER,
      {
        url: `${ALT_ORIGIN}/api/v1`,
        description:
          'Same API, reached on the www/apex alias of the canonical origin. It answers a 308 permanent redirect to the canonical host, so a client that follows redirects (preserving method and body) sees identical behaviour.',
      },
    ] as const)
  : ([CANONICAL_SERVER] as const)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Spec construction helpers ────────────────────────────────────────────────────
// The spec is DATA, but it is data with ~90 response objects in it, and the previous
// hand-written version is what "18 operations, 1 typed response" looked like: writing the
// same six error responses out longhand 18 times is work nobody does, so nobody did it.
// These helpers make the emitted JSON fully inline (every response object carries its own
// `content`, which is what the audit's schema-coverage check reads) while the source stays
// short enough that adding an operation without its errors looks wrong.
//
// ⚠️ `Record<string, unknown>` RETURNS, DELIBERATELY. The alternative — letting these infer
// deep literal types — makes `SPEC as const` a several-thousand-node type for no benefit;
// nothing type-checks against the shape of an OpenAPI document here, route.test.ts casts.
type Obj = Record<string, unknown>

const schemaRef = (name: string): Obj => ({ $ref: `#/components/schemas/${name}` })
const headerRef = (name: string): Obj => ({ $ref: `#/components/headers/${name}` })
const json = (schema: Obj): Obj => ({ 'application/json': { schema } })

/**
 * THE HEADER SET ON A RESPONSE THAT REACHED THE LIMITER — i.e. one that authenticated.
 * Mirrors `rateLimitHeaders()` + `baseHeaders()` in src/lib/api/respond.ts exactly; if that
 * function changes, this list is the other half of the contract.
 */
const RATE_HEADERS: Obj = {
  RateLimit: headerRef('RateLimit'),
  'RateLimit-Policy': headerRef('RateLimit-Policy'),
  'X-RateLimit-Limit': headerRef('X-RateLimit-Limit'),
  'X-RateLimit-Remaining': headerRef('X-RateLimit-Remaining'),
  'X-Request-Id': headerRef('X-Request-Id'),
}

/**
 * ⚠️ THE PRE-LIMITER FAILURES CARRY ONLY `X-Request-Id`, AND THAT ASYMMETRY IS ON PURPOSE.
 * A missing/malformed/revoked credential and a 503 from the auth backend are rejected by
 * resolveApiKey before any bucket is touched, so there is no measured budget to report — and
 * advertising `limit=600, remaining=600` to an unauthenticated caller would be inventing one.
 * See the comment on ApiAuthResult in src/lib/api/auth.ts.
 */
const ID_ONLY: Obj = { 'X-Request-Id': headerRef('X-Request-Id') }

function ok(description: string, schema: Obj, extraHeaders: Obj = {}): Obj {
  return { description, headers: { ...RATE_HEADERS, ...extraHeaders }, content: json(schema) }
}

/**
 * An error response, with the ACTUAL `error.code` values that status can carry named in the
 * description.
 *
 * ⚠️ THE CODES GO IN THE DESCRIPTION, NOT INTO AN `enum` ON THE SCHEMA. An enum is a closed
 * set, and `error.code` is not one: `POST /listings` re-emits `PublishBlockCode` verbatim
 * (src/lib/publish-guard.ts) and the enforcement ladder re-emits `GateError.error`, both of
 * which grow without touching this file. A client that pattern-matched a generated enum would
 * break on the thirteenth publish code; a client reading the prose knows to have a default arm.
 */
function fail(description: string, codes: readonly string[], opts: { rate?: boolean; retryAfter?: boolean } = {}): Obj {
  return {
    description: `${description} \`error.code\` is one of: ${codes.map((c) => `\`${c}\``).join(', ')}.`,
    headers: {
      ...(opts.rate === false ? ID_ONLY : RATE_HEADERS),
      ...(opts.retryAfter ? { 'Retry-After': headerRef('Retry-After') } : {}),
    },
    content: json(schemaRef('Error')),
  }
}

/**
 * The four failures EVERY authenticated operation shares, because they all come from the one
 * `resolveApiKey()` guard at the top of every handler. Spread this, then override or add the
 * statuses a specific handler can also produce.
 */
function authFailures(): Obj {
  return {
    '401': fail(
      'No credential, a malformed one, or a revoked key / expired access token. Rejected before the rate limiter, so no rate-limit headers are present.',
      ['unauthorized'],
      { rate: false },
    ),
    '403': fail(
      'The credential is valid but does not carry the scope this operation requires.',
      ['insufficient_scope'],
      { rate: false },
    ),
    '429': fail(
      'Per-API-key rate limit exceeded (600 requests per 60s, shared between a raw key and any access token minted from it). `Retry-After` and `RateLimit` say when to try again.',
      ['rate_limited'],
      { retryAfter: true },
    ),
    '503': fail(
      'The authentication backend could not be reached. The request was neither authorized nor counted — retry with backoff.',
      ['unavailable'],
      { rate: false },
    ),
  }
}

/** `{ "ok": true }` — the acknowledgement shape the mutating endpoints share. */
const OK_ACK = schemaRef('Ack')

const NOT_FOUND_LISTING = fail(
  'No listing with that id belongs to the shop this credential acts for. Ids that exist but belong to another shop are 404 as well — the API never confirms another shop\'s inventory.',
  ['not_found'],
)

// The `Idempotency-Key` request header, on the two POSTs that honour it.
const IDEMPOTENCY_KEY_PARAM: Obj = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description:
    'Opaque client-generated id (first 200 chars used). The handler runs at most once per (API key, Idempotency-Key); a retry replays the stored 2xx response and adds `Idempotency-Replayed: true`. Non-2xx results are NOT stored, so a transient failure stays retryable. Stored for 24h. A retry that arrives while the first attempt is still running gets 409 `idempotency_in_progress`.',
  schema: { type: 'string', maxLength: 200 },
}

/**
 * Per-operation security: EITHER a raw `eno_live_…` key OR an OAuth2 access token minted from
 * one. `resolveApiKey` accepts both forms on the same `Authorization: Bearer` header
 * (src/lib/api/auth.ts), so these are alternatives, not a chain — hence two entries in the array
 * (OR) rather than two keys in one object (AND).
 *
 * ⚠️ `bearerAuth` CARRIES AN EMPTY SCOPE LIST BECAUSE OPENAPI REQUIRES IT TO. Scopes are only
 * meaningful on `oauth2`/`openIdConnect` schemes; the scope a raw key needs is the same one named
 * on the oauth2 entry beside it, and the description on both schemes says so.
 */
function requires(scope: (typeof OAUTH_SCOPES)[number]): Obj[] {
  return [{ bearerAuth: [] }, { oauth2: [scope] }]
}

/**
 * What each scope actually unlocks.
 *
 * ⛔ `satisfies Record<…OAUTH_SCOPES[number], string>` IS THE POINT OF THE IMPORT. The scope
 * strings are enforced by `resolveApiKey(req, '<scope>')` in the handlers and published in the
 * RFC 8414 metadata from `OAUTH_SCOPES`; three copies of a string list is how a spec ends up
 * advertising a permission nothing checks. This assertion makes a scope added to (or renamed in)
 * src/lib/api/oauth.ts fail `tsc` here until it is described, and rejects a description for a
 * scope that does not exist.
 */
const OAUTH_SCOPE_DESCRIPTIONS = {
  'listings:read': 'Read your own listings, your storefront profile, and your webhook registrations.',
  'listings:write': 'Create, edit, delete, bulk-import and sync listings; set availability; edit the storefront profile; register and remove webhooks.',
  'analytics:read': 'Read shop-level and per-listing view/lead analytics.',
  'media:write': 'Upload images and receive a first-party URL to use in a listing.',
} as const satisfies Record<(typeof OAUTH_SCOPES)[number], string>

// Machine-readable OpenAPI 3.1 description of the partner API, for client codegen + tooling.
// Hand-maintained alongside the routes (the human guide lives at /developers). Served at
// GET /api/v1/openapi.json AND at the conventional /openapi.json.
//
// ⛔ EVERY OPERATION CARRIES A UNIQUE operationId, AND THEY MUST STAY STABLE. This is the
// name an LLM tool-caller and every codegen client derives its function from, so renaming
// one is a breaking change to code we do not control — treat them like a public API symbol,
// not like a label. An agent audit on 2026-08-23 found 18 of 18 operations missing them,
// which is why the spec scored as unusable for function calling despite being complete in
// every other respect.
//
// ⛔ EVERY SCHEMA IN HERE WAS READ OFF THE HANDLER'S RETURN, NOT DESIGNED. The same audit
// found "0% of operations define typed response schemas", and the tempting fix — write the
// shape the endpoint OUGHT to return — is worse than the gap it closes: a client codes
// against the document, and a promised field that never arrives is a crash at the call site
// with nothing in our logs. Two facts that survived that pass and would not have survived a
// tidy-up:
//   · `POST /listings` returns `{ listing: { id, verified } }` — NOT a serialized Listing.
//     `createListingCore` ends `return { id: listing.id, verified: true }`. A client that
//     wanted the created row has to GET it.
//   · `ListingInput` used to advertise `externalId` ("Your own id (for sync/upsert)") on
//     `POST /listings`. `createListingCore` never reads `body.externalId` — verified by
//     enumerating every `body.*` access in it — so the field was silently discarded, and a
//     partner following the spec would have created listings their sync could not match.
//     externalId is real on /listings/bulk and /listings/sync ONLY, which now have their own
//     input schemas listing exactly the fields their mappers read.
export const SPEC = {
  openapi: '3.1.0',
  info: {
    title: `${SITE_NAME} Partner API`,
    version: '1.0.0',
    summary: `Programmatic management of one ${SITE_NAME} storefront: listings, media, webhooks and analytics.`,
    description: [
      `Manage your ${SITE_NAME} storefront programmatically. One credential acts for exactly one shop and can only ever see or change that shop's data; ids belonging to another shop are indistinguishable from ids that do not exist (404).`,
      '',
      '## Authentication',
      'Send `Authorization: Bearer <credential>` on every request. Two credential forms are accepted on that same header and are interchangeable:',
      '- the raw API key (`eno_live_…`) from your dashboard → Developers, and',
      '- a short-lived OAuth 2.0 access token obtained from `POST /oauth/token` (client-credentials grant, RFC 6749 §4.4), which is preferable for long-running clients because the long-lived key then never travels on a per-request header.',
      'Every operation names the scope it needs. A credential missing that scope gets 403 `insufficient_scope`; the `scope` parameter on the token endpoint can narrow a token below its key\'s scopes but never above them.',
      '',
      '## Rate limits',
      'Authenticated responses (success and error alike) carry `RateLimit` and `RateLimit-Policy` (draft-ietf-httpapi-ratelimit-headers) alongside the older `X-RateLimit-Limit` / `X-RateLimit-Remaining` pair, plus an `X-Request-Id` to quote in a support request. The budget is per API key: 600 requests per 60 seconds, shared between the raw key and every token minted from it.',
      '⚠️ `reset` is the end of the current window slot, not the moment you are unblocked. The limiter is a weighted sliding window, so usage decays continuously; read `reset` as "your oldest counted requests start rolling off no later than this". A 429 additionally carries `Retry-After` with the same number.',
      '`POST /oauth/token` reports its OWN, much tighter policy (credential-guessing defence: 30/min per IP AND 60/min per client). Do not infer the API budget from it.',
      '`GET /status` is the one operation here that needs no credential, and it publishes the same header set from the same limiter — fetch it once to see the exact shape your client will have to parse. Its policy is 60/min per client IP; that is a discovery budget, not yours.',
      '',
      '## Errors',
      'Every failure is `{"error":{"code":"…","message":"…"}}` with an HTTP status that matches. Branch on `code`, not on `message` — messages are prose and may be reworded. `code` is an open set: new codes appear without notice (the create path re-emits the publish guard\'s own codes verbatim), so always have a default arm. Some 4xx add an `error.detail` string with the specific offending value.',
      'Any path under `/api` that matches no route answers 404 in this same envelope, plus an `error.hint` pointing at this document.',
      '',
      '## Idempotency',
      '`POST /listings` and `POST /listings/bulk` honour an `Idempotency-Key` request header — send one and a network retry replays the first result instead of creating twice. `POST /listings/sync` needs none: it upserts by your `externalId`, so re-sending is naturally idempotent.',
      '',
      '## Versioning and deprecation',
      '- The major version is in the URL path (`/api/v1`). A breaking change ships as a new path; the shape of `/api/v1` does not change underneath a client.',
      '- Additive changes ship inside v1 without notice: new response fields, new optional request fields, new operations, new `error.code` values. Clients MUST ignore fields they do not recognise and MUST NOT treat any enumeration in this document as closed unless it says otherwise.',
      '- When an operation is scheduled for removal it is marked `deprecated: true` in this document and its responses carry the `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers naming the date. Those headers are the machine-readable signal to watch for; this document is the human-readable one.',
      '- Nothing in this version is deprecated today and no sunset date has been set for anything in it. That is a statement of current fact, not a commitment to a notice period — no retirement timeline has been published.',
      '- This document is served by the same deployment it describes, so it cannot describe a build that is not running.',
      '',
      '## Discovery',
      `- \`${CANONICAL_ORIGIN}/api/v1/status\` — unauthenticated service document: which edition answered, the API version, and a machine-readable index of every link below. Start here.`,
      `- \`${CANONICAL_ORIGIN}/openapi.json\` — this document (also at \`${CANONICAL_ORIGIN}/api/v1/openapi.json\`).`,
      `- \`${CANONICAL_ORIGIN}/.well-known/oauth-authorization-server\` — RFC 8414 authorization-server metadata for the token endpoint below.`,
      `- \`${CANONICAL_ORIGIN}/.well-known/oauth-protected-resource\` — RFC 9728 metadata for this API as a protected resource.`,
      `- \`${CANONICAL_ORIGIN}/llms.txt\` — site index for agents.`,
      `- \`${CANONICAL_ORIGIN}/developers\` — the human guide, with worked examples.`,
    ].join('\n'),
    contact: { name: `${SITE_NAME} partner support`, url: `${CANONICAL_ORIGIN}/developers` },
  },
  // ⛔ DERIVED, NOT HARDCODED — THIS FILE IS SHARED BY BOTH DEPLOYMENTS. It read
  // 'https://eno.vn/api/v1' as a literal, and /api/v1 compiles into both editions, so
  // eno.forum served a spec titled "eno.vn Partner API" pointing every generated client
  // at the other domain. Found 2026-08-23, the same shape as the static llms.txt that
  // introduced eno.forum as eno.vn — and worse here, because a spec is consumed by
  // codegen and tool-callers that will not notice the name is wrong.
  servers: SERVERS,
  // Fallback only: every operation below states its own requirement. Both entries are
  // alternatives — one credential satisfies the operation.
  security: [{ bearerAuth: [] }, { oauth2: [] }],
  /**
   * ⚠️ A MECHANISM STATEMENT, NOT A PROMISE. Machine-readable so a tool can assert "this API
   * declares a deprecation policy" without parsing prose, and deliberately carrying no dates,
   * no notice period and no support window — none has been agreed, and inventing one here is a
   * commitment the owner never made that a partner would reasonably rely on.
   */
  'x-deprecation-policy': {
    versioningScheme: 'uri-path',
    currentVersion: 'v1',
    deprecatedOperations: [],
    sunsetDates: {},
    signals: {
      spec: 'An operation scheduled for removal carries `deprecated: true` in this document.',
      headers: ['Deprecation (RFC 9745)', 'Sunset (RFC 8594)'],
    },
    breakingChangePolicy: 'A breaking change ships as a new major version under a new URL path; /api/v1 is not reshaped in place.',
    additiveChangePolicy: 'New fields, operations and error codes may be added to v1 without notice. Clients must ignore unknown fields.',
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: [
          'An `eno_live_…` key from your dashboard → Developers, sent as `Authorization: Bearer eno_live_…`.',
          'The key\'s scopes are fixed when it is minted; the operation-level `security` on this document names the scope each call requires.',
          '⚠️ The scope names cannot be expressed on an `http`/`bearer` scheme in OpenAPI — see the `oauth2` scheme beside this one for the named list. Both schemes authenticate the same requests: `resolveApiKey` accepts a raw key or a token on the identical header.',
        ].join(' '),
      },
      oauth2: {
        type: 'oauth2',
        description: [
          'OAuth 2.0 client-credentials grant (RFC 6749 §4.4). `client_id` is the key prefix (the visible first 16 characters), `client_secret` is the full `eno_live_…` key.',
          'Credentials may be sent as HTTP Basic or as `client_id`/`client_secret` in the request body; `client_id` is optional in both forms and is verified against the key prefix when present.',
          'The token is a bearer JWT valid for 3600 seconds and is accepted anywhere the raw key is. Tokens are stateless: revoking the underlying key takes effect within the token lifetime.',
          'There is no authorization endpoint, no refresh token, no PKCE and no `jwks_uri` — the tokens are signed symmetrically and are opaque to clients by contract. Do not parse one; treat it as a string.',
        ].join(' '),
        flows: {
          clientCredentials: {
            tokenUrl: `${CANONICAL_ORIGIN}/api/v1/oauth/token`,
            scopes: OAUTH_SCOPE_DESCRIPTIONS,
          },
        },
      },
    },
    headers: {
      'X-Request-Id': {
        description: 'Unique id for this response. On every /api/v1 response except `POST /oauth/token` (which builds its headers separately). Quote it in a support request.',
        schema: { type: 'string', format: 'uuid' },
      },
      RateLimit: {
        description: 'draft-ietf-httpapi-ratelimit-headers structured-field dictionary. `reset` is seconds until the current window slot advances, NOT a guarantee of when you are unblocked — the limiter decays continuously.',
        example: 'limit=600, remaining=599, reset=42',
        schema: { type: 'string' },
      },
      'RateLimit-Policy': {
        description: 'The quota itself: `<limit>;w=<window-seconds>`. Read the window from here rather than inferring it from a running `remaining`.',
        example: '600;w=60',
        schema: { type: 'string' },
      },
      'X-RateLimit-Limit': {
        description: 'Pre-standard alias for the `limit` member of `RateLimit`. Kept because partners already branch on it; prefer `RateLimit`.',
        example: 600,
        schema: { type: 'integer' },
      },
      'X-RateLimit-Remaining': {
        description: 'Pre-standard alias for the `remaining` member of `RateLimit`.',
        example: 599,
        schema: { type: 'integer' },
      },
      'Retry-After': {
        description: 'Delay-seconds. Emitted ONLY on 429 — a 4xx about a malformed body is not worth retrying, and saying otherwise would be telling a client to loop.',
        example: 42,
        schema: { type: 'integer', minimum: 1 },
      },
      'Idempotency-Replayed': {
        description: 'Present only when this response is a replay of an earlier request with the same `Idempotency-Key` — the work was NOT performed again.',
        example: 'true',
        schema: { type: 'string', enum: ['true'] },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        description: 'The one failure envelope for this API. Branch on `error.code`.',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', description: 'Stable machine-readable reason. An OPEN set — handle unknown values.' },
              message: { type: 'string', description: 'Human-readable English explanation. Prose: may be reworded without notice.' },
              detail: { type: 'string', description: 'Optional. The specific offending value, when naming it helps — e.g. the id of the live listing a create was refused as a duplicate of.' },
              hint: { type: 'string', description: 'Optional. Present on the generic 404 returned for a path under /api that matches no route; points at this document.' },
            },
          },
        },
      },
      Ack: {
        type: 'object',
        description: 'Bare acknowledgement returned by mutations that have nothing to report back.',
        required: ['ok'],
        properties: { ok: { type: 'boolean', const: true } },
      },
      ApiStatus: {
        type: 'object',
        description: 'Unauthenticated service document. Constants plus one live rate-limit snapshot — it reads no table and reflects no shop, so nothing in it varies by caller except `time` and `rate_limit`.',
        required: ['service', 'edition', 'api_version', 'status', 'time', 'documentation', 'rate_limit'],
        properties: {
          // ⚠️ DERIVED, like every other self-naming value in this file. A reviewer measured this
          // as the ONE remaining literal `eno.vn` in the spec — it would have shipped verbatim in
          // eno.forum's public /openapi.json, reintroducing the exact cross-edition naming leak the
          // rest of this change set exists to close.
          service: { type: 'string', description: `Human-readable name of this API, e.g. "${SITE_NAME} Partner API".` },
          edition: {
            type: 'string',
            enum: ['marketplace', 'services'],
            description: 'Which of the two builds of this codebase answered. Useful after a redirect or from a stale link, when a client cannot be sure which host it reached.',
          },
          api_version: { type: 'string', const: 'v1', description: 'Matches the `/api/v1` path segment. A future major version answers on a different path, not with a different value here.' },
          status: {
            type: 'string',
            const: 'ok',
            description: '⚠️ LIVENESS ONLY — it means this deployment answered, and nothing more. No dependency is probed: the rate limiter fails open, so an unreachable database still returns "ok". Do NOT wire an alert to this field; there is deliberately no `database` field beside it, because this handler cannot truthfully compute one.',
          },
          time: { type: 'string', format: 'date-time', description: 'Server time when the response was built (RFC 3339, UTC).' },
          documentation: {
            type: 'object',
            description: 'Absolute URLs on this deployment\'s CANONICAL origin, which is what the edition was built with — not an echo of the Host header you happened to reach it on. So a request through a preview alias or an apex-to-www redirect still gets the canonical links, which is the useful answer. Follow them rather than assembling paths yourself: the host differs per edition.',
            required: ['openapi', 'oauth_authorization_server', 'oauth_protected_resource', 'developers', 'llms_txt'],
            properties: {
              openapi: { type: 'string', format: 'uri', description: 'This document.' },
              oauth_authorization_server: { type: 'string', format: 'uri', description: 'RFC 8414 authorization-server metadata for the token endpoint.' },
              oauth_protected_resource: { type: 'string', format: 'uri', description: 'RFC 9728 metadata describing this API as a protected resource.' },
              developers: { type: 'string', format: 'uri', description: 'The human guide, with worked examples.' },
              llms_txt: { type: 'string', format: 'uri', description: 'Site index for agents.' },
            },
          },
          rate_limit: {
            type: 'object',
            description: 'The SAME limiter snapshot the `RateLimit` header on this response was built from — body and headers cannot disagree. Present so a client can self-throttle without a header-parsing library.',
            required: ['limit', 'remaining', 'reset', 'window_seconds', 'keyed_by', 'authenticated'],
            properties: {
              limit: { type: 'integer', description: 'Requests allowed per window on THIS endpoint. 60 today; read it, do not hardcode it.' },
              remaining: { type: 'integer', description: 'Left in the current window for your IP.' },
              reset: { type: 'integer', minimum: 1, description: 'Seconds until the current window slot advances — the same caveat as the `RateLimit` header: the limiter decays continuously, so this is not a promise of when you are unblocked.' },
              window_seconds: { type: 'integer', description: 'Window length. `RateLimit-Policy` states the same pair as `<limit>;w=<window_seconds>`.' },
              keyed_by: { type: 'string', const: 'ip', description: 'This endpoint is bucketed per client IP, because an unauthenticated caller has no key to bucket by.' },
              authenticated: {
                type: 'object',
                description: '⚠️ The budget the REST of the API runs on, stated outright so it is never inferred from the much smaller discovery budget above. Applies once you send a credential; keyed per API key and shared with every access token minted from it.',
                required: ['limit', 'window_seconds', 'keyed_by'],
                properties: {
                  limit: { type: 'integer' },
                  window_seconds: { type: 'integer' },
                  keyed_by: { type: 'string', const: 'api_key' },
                },
              },
            },
          },
        },
      },
      Category: {
        type: 'object',
        description: 'The listing\'s category, embedded.',
        required: ['id', 'name', 'nameVi', 'slug', 'icon', 'color'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: 'English name.' },
          nameVi: { type: 'string', description: 'Vietnamese name.' },
          slug: { type: 'string', description: 'The value to send as `categorySlug` when creating.' },
          icon: { type: 'string' },
          color: { type: 'string', enum: ['brand', 'sky', 'indigo', 'violet', 'cyan', 'teal'], description: 'Design-system palette slot. Closed set (CategoryColor).' },
        },
      },
      ListingSeller: {
        type: 'object',
        description: 'The storefront the listing belongs to, embedded in every serialized listing. Always your own shop on this API.',
        required: ['id', 'name', 'avatarColor', 'avatarUrl', 'rating', 'reviewCount', 'verifiedSeller', 'officialPartner', 'trustTier', 'trustScore', 'responseRate', 'responseTime', 'memberSince', 'phone', 'isBusiness'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          avatarColor: { type: 'string', description: 'Hex colour for the initials fallback when `avatarUrl` is null.' },
          avatarUrl: { type: ['string', 'null'], format: 'uri' },
          rating: { type: 'number' },
          reviewCount: { type: 'integer' },
          verifiedSeller: { type: 'boolean' },
          officialPartner: { type: 'boolean', description: 'A commercial relationship eno asserts — not a verification and not a trust tier.' },
          trustTier: { type: 'string', description: 'restricted | standard | trusted | exceptional.' },
          trustScore: { type: 'integer' },
          responseRate: { type: 'integer' },
          responseTime: { type: 'string' },
          memberSince: { type: 'string', format: 'date-time' },
          phone: {
            type: ['string', 'null'],
            description: '⚠️ ALWAYS null in this projection. `serializeListing` omits the phone from list and detail payloads to prevent bulk PII harvesting; it is not withheld only from other shops.',
          },
          isBusiness: { type: 'boolean' },
        },
      },
      Listing: {
        type: 'object',
        description: 'A serialized listing, exactly as `serializeListing()` emits it. Dates are ISO 8601 strings.',
        required: [
          'id', 'title', 'titleVi', 'description', 'price', 'priceUnit', 'currency', 'negotiable',
          'prevPrice', 'priceDropAt', 'dropExpiresAt', 'urgent', 'urgentUntil', 'location', 'district',
          'city', 'lat', 'lng', 'condition', 'images', 'video', 'categoryId', 'subcategorySlug',
          'brandSlug', 'model', 'listingType', 'category', 'sellerId', 'seller', 'verified', 'status',
          'verificationMethod', 'verifiedAt', 'verifiedBy', 'verificationNotes', 'postedAt', 'views',
          'savedCount', 'contactCount', 'availabilityConfirmedAt', 'featured', 'attributes', 'year',
          'mileageKm', 'engineL',
        ],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          titleVi: { type: ['string', 'null'], description: 'Machine translation of the title into Vietnamese, when one has been warmed.' },
          description: { type: 'string' },
          price: { type: 'number' },
          priceUnit: { type: 'string', description: 'Currency code the amount is denominated in. "VND" for every listing today.' },
          currency: { type: 'string', description: 'Display symbol for `priceUnit` (e.g. "₫"). Presentation, not a second currency.' },
          negotiable: { type: 'boolean' },
          prevPrice: { type: ['number', 'null'], description: 'The pre-drop price while a price-drop badge is live, else null.' },
          priceDropAt: { type: ['string', 'null'], format: 'date-time', description: 'When the live drop landed. Null once the badge lapses.' },
          dropExpiresAt: { type: ['string', 'null'], format: 'date-time', description: 'When the price-drop badge stops showing.' },
          urgent: { type: 'boolean', description: 'True while an "urgent" boost is unexpired.' },
          urgentUntil: { type: ['string', 'null'], format: 'date-time' },
          location: { type: 'string' },
          district: { type: ['string', 'null'] },
          city: { type: 'string' },
          lat: { type: ['number', 'null'] },
          lng: { type: ['number', 'null'] },
          condition: { type: ['string', 'null'] },
          images: { type: 'array', items: { type: 'string', format: 'uri' }, description: 'First-party image URLs, in display order. Max 8.' },
          video: { type: ['string', 'null'], format: 'uri' },
          categoryId: { type: 'string' },
          subcategorySlug: { type: ['string', 'null'] },
          brandSlug: { type: ['string', 'null'] },
          model: { type: ['string', 'null'] },
          listingType: { type: 'string', description: 'sell | rent — what the listing offers. Defaults to "sell".' },
          category: schemaRef('Category'),
          sellerId: { type: 'string' },
          seller: schemaRef('ListingSeller'),
          verified: { type: 'boolean', description: 'False means the listing exists but is not publicly visible — it did not clear the auto-publish gate.' },
          status: {
            type: 'string',
            description: 'active | sold | hidden. Stored as a free string column, so treat it as an open set and default unknown values to "not active".',
          },
          verificationMethod: { type: ['string', 'null'] },
          verifiedAt: { type: ['string', 'null'], format: 'date-time' },
          verifiedBy: { type: ['string', 'null'] },
          verificationNotes: { type: ['string', 'null'] },
          postedAt: { type: 'string', format: 'date-time', description: 'Recency anchor. A successful `/confirm` bump moves it to now.' },
          views: { type: 'integer' },
          savedCount: { type: 'integer' },
          contactCount: { type: 'integer', description: 'Leads: how many buyers revealed contact or opened a chat.' },
          availabilityConfirmedAt: { type: ['string', 'null'], format: 'date-time' },
          featured: { type: 'boolean' },
          attributes: {
            type: ['object', 'null'],
            additionalProperties: true,
            description: 'Category-specific facets, free-form by design — the key set differs per category and grows with the taxonomy.',
          },
          year: { type: ['integer', 'null'], description: 'Vehicles only; null when not applicable.' },
          mileageKm: { type: ['integer', 'null'], description: 'Vehicles only.' },
          engineL: { type: ['number', 'null'], description: 'Vehicles only.' },
        },
      },
      CreatedListing: {
        type: 'object',
        description: '⚠️ What `POST /listings` returns — an id and whether the listing went live, NOT a full `Listing`. Fetch `GET /listings/{id}` if you need the serialized row.',
        required: ['id', 'verified'],
        properties: {
          id: { type: 'string' },
          verified: {
            type: 'boolean',
            const: true,
            description: [
              '⚠️ ALWAYS `true` here — this is NOT a live/held discriminator, and reading it as one is a branch that can never be taken.',
              '`createListingCore` writes `verified: true` on the insert and ends `return { id: listing.id, verified: true }`; there is no path through it that returns false.',
              'Anything that would have produced a held row THROWS `PublishBlockedError` instead of saving one, and this endpoint answers that as 422 (or 403 `account_restricted`, or 409 `duplicate_listing`).',
              'So a 201 from this endpoint means the listing is publicly visible, full stop.',
              'The field is not redundant on `Listing` — `verified` really can be false there, because an admin unverify, the moderation queue, the duplicate/provenance auto-hold, the AI-moderation auto-hold and the enforcement ladder all set it — but every one of those happens AFTER creation, so `getListing` is where you would see it.',
            ].join(' '),
          },
        },
      },
      ListingInput: {
        type: 'object',
        description: 'Fields `POST /listings` reads. Anything not listed here is IGNORED, silently — including `externalId`, which only exists on /listings/bulk and /listings/sync. ⚠️ NOT the PATCH body: `PATCH /listings/{id}` has its own, narrower schema (`ListingPatch`) because `updateListingCore` reads a different field set.',
        required: ['categorySlug', 'title', 'price'],
        properties: {
          categorySlug: { type: 'string', description: 'Category `slug`. Unknown values are refused with 422 `unknown_category`.' },
          title: { type: 'string', minLength: 3, maxLength: 140, description: 'Truncated to 140 characters. Must not contain a phone number.' },
          price: { type: 'number', minimum: 0, maximum: 1e12, description: 'In VND.' },
          description: { type: 'string', maxLength: 5000, description: 'Must not contain a phone number or other contact details.' },
          images: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', format: 'uri' },
            description: 'First-party image URLs from `POST /media`, in display order. Entries that are not recognised first-party URLs are dropped silently. ⚠️ Most categories require several photos of DIFFERENT angles before a listing goes live — the same photo repeated counts as one, and the exact minimum is per-category and can change, so read it from the 422 `photos_min` message rather than hardcoding a number.',
          },
          video: { type: 'string', format: 'uri', description: 'A canonical video URL, or null to clear it. Anything else is ignored.' },
          district: { type: 'string', maxLength: 80 },
          city: { type: 'string', maxLength: 80, description: 'Defaults to "Ho Chi Minh City" on create.' },
          location: { type: 'string', maxLength: 120, description: 'Free-text display location. Defaults to `district` or `city`.' },
          lat: { type: 'number', minimum: -90, maximum: 90 },
          lng: { type: 'number', minimum: -180, maximum: 180 },
          condition: { type: 'string', maxLength: 60 },
          listingType: { type: 'string', description: 'sell | rent, where the category allows it.' },
          subcategorySlug: { type: 'string', description: 'Inferred from the title and description when omitted.' },
          brand: { type: 'string', description: 'Resolved against the brand catalogue (typo-tolerant). Only read for categories that have brands.' },
          model: { type: 'string', maxLength: 60, description: 'Only stored when a brand resolved.' },
          attributes: { type: 'object', additionalProperties: true, description: 'Category-specific facets. Unknown keys are dropped.' },
          negotiable: { type: 'boolean' },
          urgent: { type: 'boolean', description: 'Requests the "Bán gấp" boost. Granted only if the shop\'s urgent quota is free; a PATCH that exceeds the quota is refused with 409 `urgent_quota`.' },
          contactName: { type: 'string', maxLength: 80, description: 'Checked against the contact-in-name publish gate.' },
        },
      },
      /**
       * ⛔ PATCH IS NOT "ListingInput WITH THE required ARRAY IGNORED", AND REUSING IT WAS A LIE IN
       * BOTH DIRECTIONS.
       *   · `ListingInput` declares `required: ['categorySlug','title','price']`, so a generated
       *     client — or any request validator built from this document — refuses the perfectly
       *     legal `PATCH /api/v1/listings/abc {"price":5000000}`, which is the single most common
       *     call this endpoint gets.
       *   · It advertises `categorySlug` and `location`, and `updateListingCore` reads NEITHER. A
       *     partner who obeyed the schema and sent `categorySlug` to move a listing between
       *     categories got `200 {"ok":true}` back and nothing moved — the worst possible outcome,
       *     because it is indistinguishable from success.
       *
       * ⚠️ EVERY PROPERTY BELOW CAME FROM ENUMERATING EVERY `body.*` ACCESS IN `updateListingCore`
       * (src/lib/core/listings.ts), the same method that caught `externalId` on `POST /listings`.
       * Nothing was carried over from `ListingInput` on the assumption that create and edit read
       * the same body; they demonstrably do not. Anything not listed here is discarded silently.
       */
      ListingPatch: {
        type: 'object',
        description: [
          'Sparse edit. Every field is optional and only the ones PRESENT are touched — `updateListingCore` keys on `!== undefined`, so sending `null` is a different instruction from omitting the key (where a null is meaningful the field below says so).',
          'A body whose keys are all unreadable is not an error: the handler returns `{"ok":true}` having written nothing.',
          '⛔ NOT READABLE HERE, THOUGH `POST /listings` ACCEPTS THEM: `categorySlug` (an edit CANNOT move a listing between categories — send it and it is ignored, and you still get 200) and `location` (derived from `district`, never read from the body). `externalId` is not readable on this path either; it exists only on /listings/bulk and /listings/sync.',
        ].join(' '),
        properties: {
          title: { type: 'string', minLength: 3, maxLength: 140, description: 'Trimmed and truncated to 140. Shorter than 3 characters after trimming is refused with `title_too_short`. Also clears the stored Vietnamese title, which is re-warmed asynchronously.' },
          description: { type: 'string', maxLength: 5000, description: 'Trimmed and truncated to 5000.' },
          contactName: { type: 'string', maxLength: 80, description: 'Screened only — it is checked against the contact-in-name gate (`contact_in_name`) and the phone-in-text rule, and is NOT written to the listing.' },
          price: { type: 'number', minimum: 0, maximum: 1e12, description: 'In VND. Non-finite, negative or above 1e12 is refused with `invalid_price`. A change also clears the denormalized "good price" verdict and runs the price-drop pipeline.' },
          district: { type: ['string', 'null'], maxLength: 80, description: 'Empty string or null clears it. ⚠️ This is also what sets the listing\'s display `location` — there is no separate `location` field on this path.' },
          city: { type: 'string', maxLength: 80, description: 'Only written when truthy: sending `""` or `null` leaves the stored city unchanged rather than clearing it.' },
          lat: { type: ['number', 'null'], minimum: -90, maximum: 90, description: 'Out-of-range or unparseable values are stored as null, not refused.' },
          lng: { type: ['number', 'null'], minimum: -180, maximum: 180, description: 'Out-of-range or unparseable values are stored as null, not refused.' },
          condition: { type: ['string', 'null'], maxLength: 60, description: 'Empty string or null clears it.' },
          images: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', format: 'uri' },
            description: 'Read ONLY when it is a JSON array (a string is ignored, not an error). Entries that are not recognised first-party URLs are dropped, then the first 8 are kept, and the surviving set must still clear the per-category different-angles bar — so an edit cannot quietly strip a live listing down to one photo (`photos_min` / `photo_required`). Send the full set you want, not a delta.',
          },
          video: { type: ['string', 'null'], format: 'uri', description: 'A canonical first-party video URL sets it; `null` or `""` clears it; ⚠️ anything else is IGNORED and the stored clip is left alone — deliberately, so a malformed URL cannot delete a live video.' },
          subcategorySlug: { type: ['string', 'null'], description: 'Must belong to the listing\'s (unchangeable) category; a slug from another category is ignored silently. `null`/`""` clears it.' },
          listingType: { type: 'string', description: 'sell | rent. Ignored silently when the value is not one the listing\'s category allows.' },
          brand: { type: ['string', 'null'], description: 'Read ONLY for categories that have brands; ignored entirely elsewhere. Resolved against the brand catalogue (typo-tolerant); an unresolvable name clears the brand rather than failing. Clearing the brand also clears `model`.' },
          model: { type: ['string', 'null'], maxLength: 60, description: 'Read ONLY for categories that have brands. Stored only while a brand is set — with no brand it is written as null whatever you send.' },
          attributes: { type: 'object', additionalProperties: true, description: 'Category-specific facets. Unknown keys are dropped; a derived layer (e.g. providerType) is re-applied on top, so this is a replace-with-sanitized-set, not a merge with what is stored.' },
          negotiable: { type: 'boolean', description: 'Coerced to a boolean. ⚠️ Forced to `false` for the `services` category whatever you send. Setting it false also ends an in-progress "urgent" run, because urgency promises price flexibility.' },
          urgent: { type: 'boolean', description: 'Requests (or ends) the "Bán gấp" boost; the string `"true"` is accepted as well. Activation runs the full server gate: over the per-shop quota is 409 `urgent_quota`; inside the 7-day re-arm cooldown the boost is simply not re-armed and the REST of the edit still saves. A successful activation also forces `negotiable: true`.' },
          year: { type: ['integer', 'null'], description: 'Range facet — read only when the listing\'s current category+subcategory declares it (vehicles). `null`/`""` clears it; out-of-range numbers are CLAMPED to the facet\'s bounds, not refused.' },
          mileageKm: { type: ['integer', 'null'], description: 'Range facet, same rules as `year`.' },
          engineCc: { type: ['integer', 'null'], description: 'Range facet, same rules as `year`.' },
          engineL: { type: ['number', 'null'], description: 'Range facet, same rules as `year`; rounded to one decimal.' },
          areaM2: { type: ['integer', 'null'], description: 'Range facet, same rules as `year` (property).' },
          salaryM: { type: ['integer', 'null'], description: 'Range facet, same rules as `year` (jobs).' },
        },
      },
      BulkListingInput: {
        type: 'object',
        description: 'One row of `POST /listings/bulk`. ⚠️ A NARROWER FIELD SET than `ListingInput`: the bulk mapper reads only these, so listingType, subcategorySlug, brand, model, attributes, city, lat, lng, video, negotiable and urgent are discarded here even though the single-create path honours them.',
        properties: {
          categorySlug: { type: 'string', description: 'Also accepted as `category_slug`.' },
          title: { type: 'string', minLength: 3 },
          description: { type: 'string' },
          price: { type: 'number', minimum: 0, maximum: 1e12 },
          district: { type: 'string' },
          condition: { type: 'string' },
          images: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
            description: 'Remote URLs are fetched and re-hosted first-party (SSRF-guarded). Also accepted as `image_urls`, a pipe-separated string. A per-import fetch budget applies — see `image_budget_reached`.',
          },
          externalId: { type: 'string', maxLength: 128, description: 'Your own id, echoed back in `results[]`. Also accepted as `external_id`.' },
        },
      },
      SyncListingInput: {
        type: 'object',
        description: 'One row of `POST /listings/sync`, keyed by `externalId`. Only these fields are read.',
        required: ['externalId'],
        properties: {
          externalId: { type: 'string', maxLength: 128, description: 'Your own SKU. Unique per shop; the upsert key. Also accepted as `external_id`. Required — a row without one fails.' },
          categorySlug: { type: 'string' },
          title: { type: 'string', minLength: 3 },
          description: { type: 'string' },
          price: { type: 'number', minimum: 0, maximum: 1e12 },
          district: { type: 'string' },
          condition: { type: 'string' },
          images: { type: 'array', items: { type: 'string', format: 'uri' }, description: 'Remote URLs are re-hosted first-party, as in bulk.' },
          status: { type: 'string', enum: ['active', 'sold', 'hidden'], description: 'Sets availability on an existing row.' },
        },
      },
      Shop: {
        type: 'object',
        description: 'The storefront the credential acts for.',
        required: ['id', 'name', 'bio', 'location', 'phone', 'avatar_url', 'trust_score', 'trust_tier', 'response_rate', 'member_since', 'active_listings'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          bio: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'], description: 'Your own shop\'s phone — returned here because it is your data.' },
          avatar_url: { type: ['string', 'null'], format: 'uri' },
          trust_score: { type: 'integer' },
          trust_tier: { type: 'string', description: 'restricted | standard | trusted | exceptional.' },
          response_rate: { type: 'integer', description: 'Percentage. Defaults to 100 until a nightly job has a large enough sample to measure one.' },
          member_since: { type: 'string', format: 'date-time' },
          active_listings: { type: 'integer', description: 'Listings that are both `verified` and `active` — i.e. publicly visible right now.' },
        },
      },
      ShopInput: {
        type: 'object',
        description: 'Sparse storefront edit. Only the fields present are changed.',
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 120 },
          bio: { type: 'string', maxLength: 1000, description: 'Empty string clears it.' },
          location: { type: 'string', maxLength: 120, description: 'Empty string clears it.' },
          avatarUrl: { type: 'string', format: 'uri', description: 'Must be a first-party image URL.' },
          phone: { type: 'string', description: 'Unique across shops — an in-use number is refused with `phone_taken`.' },
        },
      },
      Webhook: {
        type: 'object',
        description: 'A registered endpoint, as returned by `GET /webhooks`. The signing secret is NEVER included here.',
        required: ['id', 'url', 'events', 'enabled', 'failure_count', 'last_error', 'last_delivery_at', 'created_at'],
        properties: {
          id: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' }, description: 'The subscribed event names, or the single element `"*"` for all.' },
          enabled: { type: 'boolean', description: 'Set false automatically after sustained delivery failures.' },
          failure_count: { type: 'integer' },
          last_error: { type: ['string', 'null'] },
          last_delivery_at: { type: ['string', 'null'], format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      NewWebhook: {
        type: 'object',
        description: '⚠️ What `POST /webhooks` returns — it carries `secret` and, unlike the list projection, does NOT carry `failure_count`, `last_error` or `last_delivery_at` (a brand-new endpoint has no delivery history).',
        required: ['id', 'url', 'events', 'enabled', 'created_at', 'secret'],
        properties: {
          id: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          secret: { type: 'string', description: '⛔ RETURNED ONCE, HERE, AND NEVER AGAIN. Store it: it is the HMAC key for the `webhook-signature` header on every delivery.' },
        },
      },
      AnalyticsSummary: {
        type: 'object',
        description: 'Shop-wide rollup. Counts cover every listing the shop has ever had, in any status.',
        required: ['total_listings', 'total_views', 'total_leads', 'active', 'sold', 'hidden', 'held'],
        properties: {
          total_listings: { type: 'integer' },
          total_views: { type: 'integer' },
          total_leads: { type: 'integer', description: 'Sum of contact reveals / chat opens across all listings.' },
          active: { type: 'integer' },
          sold: { type: 'integer' },
          hidden: { type: 'integer' },
          held: { type: 'integer', description: 'Listings that are `active` but NOT `verified` — they failed the auto-publish gate and are not publicly visible. Not a `status` value; a derived count.' },
        },
      },
      ListingAnalyticsRow: {
        type: 'object',
        required: ['id', 'external_id', 'title', 'status', 'views_total', 'leads_total', 'daily'],
        properties: {
          id: { type: 'string' },
          external_id: { type: ['string', 'null'], description: 'Your own id, when the listing was created through bulk or sync.' },
          title: { type: 'string' },
          status: { type: 'string' },
          views_total: { type: 'integer', description: 'Current CUMULATIVE total, not a total for the requested range.' },
          leads_total: { type: 'integer', description: 'Current cumulative total.' },
          daily: {
            type: 'array',
            description: 'Per-day DELTAS inside the requested range, ascending. A day only appears if a snapshot exists for it — gaps are real, not zeroes. The first day of a series is 0/0 when no earlier snapshot exists to difference against.',
            items: {
              type: 'object',
              required: ['day', 'views', 'leads'],
              properties: {
                day: { type: 'string', format: 'date' },
                views: { type: 'integer', minimum: 0 },
                leads: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
      },
      BulkRowResult: {
        type: 'object',
        description: 'One row\'s outcome. Rows are independent: a bad row never aborts the batch.',
        required: ['row', 'id', 'external_id', 'error'],
        properties: {
          row: { type: 'integer', description: '1-based index into the array you sent.' },
          id: { type: ['string', 'null'], description: 'The created listing id, or null if the row failed.' },
          external_id: { type: ['string', 'null'], description: 'Echoed back when the row carried one.' },
          error: { type: ['string', 'null'], description: 'Human-readable reason the row failed, or null. ⚠️ Free prose, not a stable code — the one exception is `probation_listing_cap`, emitted verbatim when a new account hits its active-listing cap.' },
        },
      },
      SyncRowResult: {
        type: 'object',
        required: ['external_id', 'action'],
        properties: {
          external_id: { type: ['string', 'null'], description: 'Null only for a row that had no usable externalId.' },
          id: { type: 'string', description: 'Present for created and updated rows; absent when the row failed before a listing existed.' },
          action: { type: 'string', enum: ['created', 'updated', 'failed'] },
          error: { type: 'string', description: 'Present only when `action` is "failed". Free prose, not a stable code.' },
        },
      },
      AccessToken: {
        type: 'object',
        description: 'RFC 6749 §5.1 successful token response.',
        required: ['access_token', 'token_type', 'expires_in', 'scope'],
        properties: {
          access_token: { type: 'string', description: 'Bearer JWT. Opaque by contract — do not parse it.' },
          token_type: { type: 'string', const: 'Bearer' },
          expires_in: { type: 'integer', description: 'Seconds. 3600 today; read the value, do not hardcode it.' },
          scope: { type: 'string', description: 'Space-separated scopes actually granted — the key\'s scopes, or the subset you requested.' },
        },
      },
      TokenRequest: {
        type: 'object',
        description: 'Client-credentials grant request. Accepted as `application/x-www-form-urlencoded` (the OAuth standard) or as JSON — the handler parses both and reads the same four fields from either.',
        required: ['grant_type'],
        properties: {
          grant_type: { type: 'string', const: 'client_credentials', description: 'The only grant this server implements. Anything else is refused before credentials are read.' },
          client_id: { type: 'string', description: 'The key prefix (first 16 characters). Optional; verified against the key in constant time when sent. Omit it, or send it via HTTP Basic instead.' },
          client_secret: { type: 'string', description: 'The full `eno_live_…` key. Required unless sent via HTTP Basic.' },
          scope: { type: 'string', description: 'Space-separated subset of the key\'s scopes. Narrows the token; requesting a scope the key lacks is 400 `invalid_scope`.' },
        },
      },
      OAuthError: {
        type: 'object',
        description: '⚠️ RFC 6749 §5.2 error envelope — FLAT, and deliberately NOT the `{"error":{"code","message"}}` shape every other endpoint uses. The OAuth spec mandates this one, and a client library performing the grant expects it.',
        required: ['error'],
        properties: {
          error: { type: 'string', description: 'unsupported_grant_type | invalid_client | invalid_scope | invalid_request | temporarily_unavailable.' },
          error_description: { type: 'string' },
        },
      },
    },
  },
  paths: {
    /**
     * ⛔ THE ONLY OPERATION IN THIS DOCUMENT WITH NO CREDENTIAL AT ALL, AND IT IS HERE BECAUSE OF
     * A MEASUREMENT. An agent audit on 2026-08-23 could not verify the rate-limit headers this
     * spec describes — "documented at /openapi.json but not verified on a live response (REST API
     * is auth-gated)" — because every endpoint an anonymous scanner can reach rejects BEFORE the
     * limiter runs and therefore carries no honest budget to publish (see the `401` descriptions
     * below, and the pre-limiter note on `authFailures()`). Neither of those rejections was
     * changed to close the gap: this operation was added so that a live response carrying real
     * `RateLimit` / `RateLimit-Policy` exists to be fetched, without leaking the authenticated
     * budget onto an unauthenticated rejection.
     */
    '/status': {
      get: {
        operationId: 'getApiStatus',
        summary: 'Service document — no credential required',
        description: [
          'Everything a client needs before it has a credential: which edition and API version answered, absolute URLs for the OpenAPI document and both OAuth metadata documents, and a live rate-limit snapshot.',
          'It reads no table and reflects no shop, so it is safe to poll — but there is nothing to poll FOR: `status` is liveness only and never says "unhealthy" (the rate limiter fails open, so an unreachable database still answers `"ok"`). Fetch it once at startup, not on a schedule.',
          '⚠️ Its rate limit is this endpoint\'s own — 60/min per client IP, a discovery budget. The authenticated API budget is 10x larger and is stated in `rate_limit.authenticated` rather than left to be inferred from the headers here.',
        ].join(' '),
        security: [],
        responses: {
          '200': ok('The service document. `Cache-Control: no-store` — the rate-limit numbers are yours alone and must never be served to another caller from a shared cache.', schemaRef('ApiStatus')),
          '429': fail(
            'More than 60 requests in 60 seconds from your IP. `Retry-After` and `RateLimit` both carry the same number of seconds.',
            ['rate_limited'],
            { retryAfter: true },
          ),
        },
      },
    },
    '/oauth/token': {
      post: {
        operationId: 'createAccessToken',
        summary: 'Exchange an API key for a short-lived access token',
        description: [
          'OAuth 2.0 client-credentials grant. Post your API key once and use the returned bearer token for the next hour, so the long-lived key does not travel on every request.',
          'Credentials go in HTTP Basic (`Authorization: Basic base64(client_id:client_secret)`) or in the body; Basic wins when both are present. `client_id` is the key prefix and is optional — when sent it must match the key.',
          'The optional `scope` parameter narrows the token to a subset of the key\'s scopes and can never widen it.',
          '⚠️ This endpoint has its OWN rate limit (30/min per IP AND 60/min per client) — far tighter than the 600/min API budget, because it is the credential-guessing surface. Its `RateLimit` headers describe that policy, not yours.',
        ].join(' '),
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': { schema: schemaRef('TokenRequest') },
            'application/json': { schema: schemaRef('TokenRequest') },
          },
        },
        responses: {
          '200': {
            description: 'A new access token. `Cache-Control: no-store` — never persist this response body beyond the token\'s own lifetime.',
            headers: {
              RateLimit: headerRef('RateLimit'),
              'RateLimit-Policy': headerRef('RateLimit-Policy'),
              'X-RateLimit-Limit': headerRef('X-RateLimit-Limit'),
              'X-RateLimit-Remaining': headerRef('X-RateLimit-Remaining'),
            },
            content: json(schemaRef('AccessToken')),
          },
          '400': {
            description: 'The grant is not one we implement, or the requested `scope` is not a subset of the key\'s. `error` is `unsupported_grant_type` or `invalid_scope`. No rate-limit headers: disclosing the throttle on the credential endpoint to an unauthenticated caller helps a brute-forcer.',
            content: json(schemaRef('OAuthError')),
          },
          '401': {
            description: 'The client_secret is not a well-formed key, the key is unknown or revoked, or a supplied client_id does not match it. `error` is `invalid_client`. Deliberately carries no `Retry-After`.',
            content: json(schemaRef('OAuthError')),
          },
          '429': {
            description: 'Too many token requests from this IP or for this client. `error` is `invalid_request`.',
            headers: {
              RateLimit: headerRef('RateLimit'),
              'RateLimit-Policy': headerRef('RateLimit-Policy'),
              'X-RateLimit-Limit': headerRef('X-RateLimit-Limit'),
              'X-RateLimit-Remaining': headerRef('X-RateLimit-Remaining'),
              'Retry-After': headerRef('Retry-After'),
            },
            content: json(schemaRef('OAuthError')),
          },
          '503': {
            description: 'The key store or the token signer is unavailable. `error` is `temporarily_unavailable`. Retry with backoff.',
            content: json(schemaRef('OAuthError')),
          },
        },
      },
    },
    '/shop': {
      get: {
        operationId: 'getShop',
        summary: 'Get your storefront profile',
        description: 'The identity behind the credential: profile, trust score and tier, response rate, and a live count of publicly visible listings.',
        security: requires('listings:read'),
        responses: {
          '200': ok('The storefront this credential acts for.', { type: 'object', required: ['shop'], properties: { shop: schemaRef('Shop') } }),
          ...authFailures(),
          '404': fail('The credential resolved to a shop row that no longer exists.', ['not_found']),
        },
      },
      patch: {
        operationId: 'updateShop',
        summary: 'Edit your storefront profile',
        description: 'Sparse update — only the fields present in the body change. Returns a bare acknowledgement, not the updated shop; call `getShop` to read it back.',
        security: requires('listings:write'),
        requestBody: { required: true, content: json(schemaRef('ShopInput')) },
        responses: {
          '200': ok('Saved.', OK_ACK),
          ...authFailures(),
          '400': fail(
            'The body was not valid JSON, or a field failed validation. ⚠️ Field validation answers 400, not 422, on this endpoint — `updateSellerCore` returns its OWN status and src/app/api/v1/shop/route.ts passes it through unflattened, which is also why a phone clash below is a 409 rather than one more code in this list. `bad_request` is the route\'s own code for unparseable JSON; the rest come from the core. ⚠️ `bad_id_number` and `bad_tax_code` are reachable even though no property on `ShopInput` produces them: `updateSellerCore` also reads the legal-identity fields `legalName`, `legalAddress`, `idNumber` and `taxCode`, which this API does not document as an input surface.',
            ['bad_request', 'name_too_short', 'bad_avatar', 'bad_phone', 'bad_id_number', 'bad_tax_code', 'no_phone_in_profile'],
          ),
          '409': fail(
            'The `phone` you sent already belongs to another account — one number, one account. ⚠️ This was previously (and wrongly) documented as a 400: `updateSellerCore` returns `{ code: 409 }` for it from BOTH of its checks — the explicit `phoneTakenByOther` lookup before the write, and the `P2002` unique-violation catch that closes the race between them — and the route passes that status straight through. Nothing about it is retryable with the same number.',
            ['phone_taken'],
          ),
        },
      },
    },
    '/listings': {
      get: {
        operationId: 'listListings',
        summary: 'List your listings',
        description: 'Every listing this shop has, in every status — including ones that are not publicly visible. Newest first, keyset-paginated: pass the `next_cursor` from the previous page back as `cursor` until it comes back null.',
        security: requires('listings:read'),
        parameters: [
          { name: 'limit', in: 'query', required: false, description: 'Page size. Clamped to 1..100; defaults to 50.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          { name: 'cursor', in: 'query', required: false, description: 'Opaque cursor from the previous page\'s `next_cursor`. Do not construct one.', schema: { type: 'string' } },
        ],
        responses: {
          '200': ok('One page of listings.', {
            type: 'object',
            required: ['listings', 'next_cursor'],
            properties: {
              listings: { type: 'array', items: schemaRef('Listing') },
              next_cursor: { type: ['string', 'null'], description: 'Pass back as `cursor` for the next page. Null on the last page.' },
            },
          }),
          ...authFailures(),
        },
      },
      post: {
        operationId: 'createListing',
        summary: 'Create a listing',
        description: [
          'Runs the exact same path as the seller-facing post wizard: auto-publish gate, brand resolution, translation warm, search reindex and webhook dispatch.',
          '⚠️ Returns `{ listing: { id, verified } }`, not the serialized listing — fetch `getListing` if you need the row. `verified` is ALWAYS `true` on a 201: this endpoint either publishes the listing or refuses it (422/403/409), it never creates a held one.',
          'Send an `Idempotency-Key` so a network retry cannot create the listing twice.',
        ].join(' '),
        security: requires('listings:write'),
        parameters: [IDEMPOTENCY_KEY_PARAM],
        requestBody: { required: true, content: json(schemaRef('ListingInput')) },
        responses: {
          '201': ok(
            'Created AND published — a 201 from this endpoint is always a publicly visible listing. `verified` is `true` on every one of them; it is not a discriminator to branch on.',
            { type: 'object', required: ['listing'], properties: { listing: schemaRef('CreatedListing') } },
            { 'Idempotency-Replayed': headerRef('Idempotency-Replayed') },
          ),
          ...authFailures(),
          '400': fail('The body was not valid JSON.', ['bad_request']),
          '403': fail(
            'Posting is blocked for this account, or the shop\'s trust score is too low to publish. ⚠️ TWO DIFFERENT RESPONSES SHARE THIS STATUS AND THEY CARRY DIFFERENT HEADERS: `insufficient_scope` is refused by the credential guard BEFORE the rate limiter and carries only `X-Request-Id`, while the account/trust codes are produced after authentication and carry the full rate-limit set below. Read the headers as "present on the post-authentication codes", not as a guarantee for the status.',
            ['insufficient_scope', 'account_held', 'account_suspended', 'probation_listing_cap', 'account_restricted'],
          ),
          '404': fail('The credential resolved to a shop row that no longer exists.', ['not_found']),
          '409': fail(
            'A live listing on this shop is already a duplicate of this one (`error.detail` carries its id), or a request with the same `Idempotency-Key` is still running.',
            ['duplicate_listing', 'idempotency_in_progress'],
          ),
          '422': fail(
            'The payload was refused by validation or by a publish gate. Fix the content and re-post.',
            ['invalid_input', 'unknown_category', 'no_phone_in_listing', 'photo_required', 'photos_min', 'banned_words', 'contact_in_text', 'contact_in_name', 'location_required', 'identity_unverified', 'identity_pending', 'identity_expired', 'identity_suspended'],
          ),
        },
      },
    },
    '/listings/{id}': {
      get: {
        operationId: 'getListing',
        summary: 'Get one of your listings',
        description: 'The full serialized listing, in any status. 404 for an id that does not exist or belongs to another shop — the two are indistinguishable on purpose.',
        security: requires('listings:read'),
        parameters: [{ name: 'id', in: 'path', required: true, description: 'The listing id.', schema: { type: 'string' } }],
        responses: {
          '200': ok('The listing.', { type: 'object', required: ['listing'], properties: { listing: schemaRef('Listing') } }),
          ...authFailures(),
          '404': NOT_FOUND_LISTING,
        },
      },
      patch: {
        operationId: 'updateListing',
        summary: 'Edit a listing',
        description: [
          'Sparse update with the same validation, republish gate and reindex as the dashboard editor. Naturally idempotent: the same body twice gives the same result. Returns a bare acknowledgement.',
          '⚠️ The body is `ListingPatch`, NOT `ListingInput` — a narrower field set with nothing required. In particular an edit CANNOT move a listing between categories: `categorySlug` is not read here, and sending it still returns 200.',
        ].join(' '),
        security: requires('listings:write'),
        parameters: [{ name: 'id', in: 'path', required: true, description: 'The listing id.', schema: { type: 'string' } }],
        requestBody: { required: true, content: json(schemaRef('ListingPatch')) },
        responses: {
          '200': ok('Saved.', OK_ACK),
          ...authFailures(),
          '400': fail('The body was not valid JSON.', ['bad_request']),
          '404': NOT_FOUND_LISTING,
          '409': fail('A retryable state conflict — the shop\'s "urgent" quota is already spent, so the boost was not applied.', ['urgent_quota']),
          '422': fail(
            'Validation or a publish gate refused the edit. ⚠️ This status collapses several core-level 400s: the route maps everything that is not 404 or 409 onto 422.',
            ['title_too_short', 'invalid_price', 'no_phone_in_listing', 'photo_required', 'photos_min', 'banned_words', 'contact_in_text', 'contact_in_name', 'location_required', 'account_restricted', 'duplicate_listing', 'identity_unverified', 'identity_pending', 'identity_expired', 'identity_suspended'],
          ),
        },
      },
      delete: {
        operationId: 'deleteListing',
        summary: 'Delete a listing',
        description: 'Permanent. Cascades the listing\'s reports and conversations and decrements its brand count. There is no undo — prefer `setListingStatus` with "hidden" if you may want it back.',
        security: requires('listings:write'),
        parameters: [{ name: 'id', in: 'path', required: true, description: 'The listing id.', schema: { type: 'string' } }],
        responses: {
          '200': ok('Deleted.', OK_ACK),
          ...authFailures(),
          '404': NOT_FOUND_LISTING,
        },
      },
    },
    '/listings/{id}/status': {
      post: {
        operationId: 'setListingStatus',
        summary: 'Set a listing\'s availability',
        description: 'active | sold | hidden. Idempotent. Marking sold from here does not attribute the sale (no buyer or channel is recorded), and re-activating clears any attribution a previous sale left behind.',
        security: requires('listings:write'),
        parameters: [{ name: 'id', in: 'path', required: true, description: 'The listing id.', schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['status'],
            properties: { status: { type: 'string', enum: ['active', 'sold', 'hidden'], description: 'Closed set — enforced server-side.' } },
          }),
        },
        responses: {
          '200': ok('Applied. Echoes the status now in effect.', {
            type: 'object',
            required: ['ok', 'status'],
            properties: { ok: { type: 'boolean', const: true }, status: { type: 'string', enum: ['active', 'sold', 'hidden'] } },
          }),
          ...authFailures(),
          '400': fail('The body was not valid JSON.', ['bad_request']),
          '404': NOT_FOUND_LISTING,
          '422': fail(
            '`status` was absent or not one of the three allowed values. ⚠️ `invalid_status` is the ONLY code this status can carry: `setStatusCore`\'s error union also names `not_found`, but it never returns it (the row is proven to exist by the route\'s ownership check, which answers 404 above), and the route maps every core failure onto 422 regardless.',
            ['invalid_status'],
          ),
        },
      },
    },
    '/listings/{id}/confirm': {
      post: {
        operationId: 'confirmListing',
        summary: 'Confirm a listing is still available',
        description: 'Stamps availability and re-activates the listing if it was sold or hidden. Bumps feed recency when the per-listing cooldown has elapsed — `bumped: false` means the call succeeded but the cooldown had not, which is not an error. No body.',
        security: requires('listings:write'),
        parameters: [{ name: 'id', in: 'path', required: true, description: 'The listing id.', schema: { type: 'string' } }],
        responses: {
          '200': ok('Confirmed. `bumped` says whether recency actually moved.', {
            type: 'object',
            required: ['ok', 'bumped'],
            properties: {
              ok: { type: 'boolean', const: true },
              bumped: { type: 'boolean', description: 'False when the cooldown since the last bump has not elapsed. Not an error.' },
            },
          }),
          ...authFailures(),
          '404': NOT_FOUND_LISTING,
        },
      },
    },
    '/listings/bulk': {
      post: {
        operationId: 'bulkCreateListings',
        summary: 'Create many listings in one call',
        description: [
          'Up to 200 rows. Every row is independent — a bad row is reported and skipped, it never aborts the batch — so the response is 200 with per-row results even when every row failed.',
          'Remote image URLs are fetched and re-hosted first-party, under a per-import fetch budget; `image_budget_reached` tells you the budget ran out and later rows were imported without their images.',
          'Send an `Idempotency-Key`: this is the endpoint where a retry costs the most.',
        ].join(' '),
        security: requires('listings:write'),
        parameters: [IDEMPOTENCY_KEY_PARAM],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            // ⚠️ `anyOf`, NOT `required: ['listings']`. The handler reads
            // `Array.isArray(body.listings) ? body.listings : Array.isArray(body.rows) ? body.rows : null`
            // (listings/bulk/route.ts:41), so a body carrying only `rows` is valid and works — but
            // the spec used to mark `listings` required while documenting `rows` as an alias in
            // prose. A generated client or a request validator would reject its own documented
            // alias. Either key satisfies the contract; that is what this says.
            anyOf: [{ required: ['listings'] }, { required: ['rows'] }],
            properties: {
              listings: { type: 'array', minItems: 1, maxItems: 200, items: schemaRef('BulkListingInput') },
              rows: { type: 'array', minItems: 1, maxItems: 200, items: schemaRef('BulkListingInput'), description: 'Accepted alias for `listings`, read only when `listings` is absent.' },
            },
          }),
        },
        responses: {
          '200': ok(
            'The batch ran. Read `results[]` — a 200 does NOT mean every row succeeded.',
            {
              type: 'object',
              required: ['created', 'failed', 'image_budget_reached', 'results'],
              properties: {
                created: { type: 'integer' },
                failed: { type: 'integer' },
                image_budget_reached: { type: 'boolean', description: 'True when the per-import remote-image fetch budget was exhausted; affected rows were created with fewer images.' },
                results: { type: 'array', items: schemaRef('BulkRowResult') },
              },
            },
            { 'Idempotency-Replayed': headerRef('Idempotency-Replayed') },
          ),
          ...authFailures(),
          '400': fail('The body was not valid JSON.', ['bad_request']),
          '403': fail(
            'Posting is blocked for this account, so the whole batch was refused before any row ran. ⚠️ TWO DIFFERENT RESPONSES SHARE THIS STATUS: `insufficient_scope` is refused before the rate limiter and carries only `X-Request-Id`; the account codes happen after authentication and carry the rate-limit set below.',
            ['insufficient_scope', 'account_held', 'account_suspended', 'probation_listing_cap'],
          ),
          '404': fail('The credential resolved to a shop row that no longer exists.', ['not_found']),
          '409': fail('A request with the same `Idempotency-Key` is still running. Retry shortly.', ['idempotency_in_progress']),
          '422': fail('The array was missing, empty, or longer than 200 rows.', ['invalid_input', 'too_many_rows']),
        },
      },
    },
    '/listings/sync': {
      post: {
        operationId: 'syncListings',
        summary: 'Upsert your catalogue by externalId',
        description: [
          'Each row is matched to a listing by your own `externalId` (unique per shop) and created or updated accordingly.',
          'mode `partial` (the default) touches only the rows you send. mode `full` additionally RETIRES — hides, not deletes — every active listing of yours whose externalId is absent from this payload, making your storefront a mirror of your system in one call.',
          'Naturally idempotent, so no `Idempotency-Key` is needed. Up to 200 rows.',
        ].join(' '),
        security: requires('listings:write'),
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['listings'],
            properties: {
              mode: { type: 'string', enum: ['partial', 'full'], default: 'partial', description: 'Anything other than the exact string "full" is treated as "partial".' },
              listings: { type: 'array', minItems: 1, maxItems: 200, items: schemaRef('SyncListingInput') },
            },
          }),
        },
        responses: {
          '200': ok('The sync ran. Read `results[]` — a 200 does NOT mean every row succeeded.', {
            type: 'object',
            required: ['mode', 'created', 'updated', 'retired', 'failed', 'results'],
            properties: {
              mode: { type: 'string', enum: ['partial', 'full'], description: 'The mode actually applied.' },
              created: { type: 'integer' },
              updated: { type: 'integer' },
              retired: { type: 'integer', description: 'Listings hidden because they were absent from a `full` sync. Always 0 in `partial` mode.' },
              failed: { type: 'integer' },
              results: { type: 'array', items: schemaRef('SyncRowResult') },
            },
          }),
          ...authFailures(),
          '400': fail('The body was not valid JSON.', ['bad_request']),
          '403': fail(
            'Posting is blocked for this account, so nothing was created, updated or retired. ⚠️ TWO DIFFERENT RESPONSES SHARE THIS STATUS: `insufficient_scope` is refused before the rate limiter and carries only `X-Request-Id`; the account codes happen after authentication and carry the rate-limit set below.',
            ['insufficient_scope', 'account_held', 'account_suspended', 'probation_listing_cap'],
          ),
          '404': fail('The credential resolved to a shop row that no longer exists.', ['not_found']),
          '422': fail('The array was missing, empty, or longer than 200 rows.', ['invalid_input', 'too_many_rows']),
        },
      },
    },
    '/media': {
      post: {
        operationId: 'uploadMedia',
        summary: 'Upload an image and get a first-party URL',
        description: 'Send one image as multipart `file`, or as a raw JPEG/PNG/WebP request body with the matching `Content-Type`. It is decoded, stripped of metadata, re-encoded to WebP and stored first-party. Put the returned URL in a listing\'s `images[]` — listing creation only accepts first-party URLs from here.',
        security: requires('media:write'),
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary', description: 'JPEG, PNG or WebP, 1 byte to 12MB.' } },
              },
            },
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            'image/png': { schema: { type: 'string', format: 'binary' } },
            'image/webp': { schema: { type: 'string', format: 'binary' } },
          },
        },
        responses: {
          '200': ok('Stored.', {
            type: 'object',
            required: ['url'],
            properties: { url: { type: 'string', format: 'uri', description: 'First-party URL of the stored WebP. Not the bytes you sent — the image is re-encoded.' } },
          }),
          ...authFailures(),
          '422': fail(
            'No usable image: wrong content type, empty, over 12MB, or the bytes could not be decoded. ⚠️ One code covers all of those — read `error.message` to tell them apart.',
            ['invalid_image'],
          ),
        },
      },
    },
    '/analytics/summary': {
      get: {
        operationId: 'getAnalyticsSummary',
        summary: 'Shop-wide views, leads and listing counts',
        description: 'A single rollup across every listing the shop has ever had. Cumulative all-time figures, not a time series — use `listListingAnalytics` for per-day numbers.',
        security: requires('analytics:read'),
        responses: {
          '200': ok('The rollup.', { type: 'object', required: ['summary'], properties: { summary: schemaRef('AnalyticsSummary') } }),
          ...authFailures(),
        },
      },
    },
    '/analytics/listings': {
      get: {
        operationId: 'listListingAnalytics',
        summary: 'Per-listing daily views and leads',
        description: [
          'Per-day DELTAS over a date range, plus each listing\'s current cumulative totals. Keyset-paginated by listing, not by day: one page covers up to `limit` listings and each carries its own `daily` series for the whole range.',
          'The series is built by differencing a nightly snapshot, so a listing created today has no history yet and a day with no snapshot is simply absent from `daily` rather than reported as zero.',
        ].join(' '),
        security: requires('analytics:read'),
        parameters: [
          { name: 'from', in: 'query', required: false, description: 'Inclusive start (YYYY-MM-DD, UTC). Defaults to 30 days before `to`. A range longer than 92 days is silently clamped to the last 92 — check `range` in the response.', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', required: false, description: 'Inclusive end (YYYY-MM-DD, UTC). Defaults to today.', schema: { type: 'string', format: 'date' } },
          { name: 'limit', in: 'query', required: false, description: 'Listings per page. Clamped to 1..100; defaults to 50.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          { name: 'cursor', in: 'query', required: false, description: 'Opaque cursor from the previous page\'s `next_cursor`.', schema: { type: 'string' } },
        ],
        responses: {
          '200': ok('One page of listings with their daily series.', {
            type: 'object',
            required: ['range', 'listings', 'next_cursor'],
            properties: {
              range: {
                type: 'object',
                description: 'The range actually served, after defaulting and clamping. Compare it with what you asked for.',
                required: ['from', 'to'],
                properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } },
              },
              listings: { type: 'array', items: schemaRef('ListingAnalyticsRow') },
              next_cursor: { type: ['string', 'null'] },
            },
          }),
          ...authFailures(),
          '422': fail('`from` is after `to`.', ['invalid_input']),
        },
      },
    },
    '/webhooks': {
      get: {
        operationId: 'listWebhooks',
        summary: 'List your webhook endpoints',
        description: 'Every endpoint registered for this shop, newest first, with delivery health. Signing secrets are never returned here — they are shown once, at registration.',
        security: requires('listings:read'),
        responses: {
          '200': ok('Your endpoints.', {
            type: 'object',
            required: ['webhooks'],
            properties: { webhooks: { type: 'array', items: schemaRef('Webhook') } },
          }),
          ...authFailures(),
        },
      },
      post: {
        operationId: 'createWebhook',
        summary: 'Register a signed-event endpoint',
        description: [
          'Registers a public HTTPS endpoint to receive listing events. The response carries the signing `secret` ONCE — store it, it is the HMAC key for the `webhook-signature` header on every delivery and cannot be retrieved later.',
          'Valid events: `listing.created`, `listing.updated`, `listing.status_changed`, `listing.deleted`. Omit `events` (or send `"*"`) to receive all of them. At most 10 endpoints per shop.',
        ].join(' '),
        security: requires('listings:write'),
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['url'],
            properties: {
              url: { type: 'string', format: 'uri', description: 'Public HTTPS endpoint. Private and internal hosts are rejected (SSRF guard).' },
              events: {
                description: 'Event names as an array or a comma/space-separated string, or `"*"`. Omitted, empty or `"*"` all mean every event.',
                oneOf: [
                  { type: 'array', items: { type: 'string', enum: ['listing.created', 'listing.updated', 'listing.status_changed', 'listing.deleted'] } },
                  { type: 'string' },
                ],
              },
            },
          }),
        },
        responses: {
          '201': ok('Registered. `secret` is in this response and nowhere else, ever.', {
            type: 'object',
            required: ['webhook'],
            properties: { webhook: schemaRef('NewWebhook') },
          }),
          ...authFailures(),
          '400': fail('The body was not valid JSON.', ['bad_request']),
          '422': fail(
            '`url` was missing, was not a public HTTPS endpoint, named an unknown event, or the shop already has 10 endpoints.',
            ['invalid_input', 'limit_reached'],
          ),
        },
      },
    },
    '/webhooks/{id}': {
      delete: {
        operationId: 'deleteWebhook',
        summary: 'Unregister a webhook endpoint',
        description: 'Removes the endpoint and its signing secret. 404 if the id is not one of this shop\'s.',
        security: requires('listings:write'),
        parameters: [{ name: 'id', in: 'path', required: true, description: 'The webhook endpoint id.', schema: { type: 'string' } }],
        responses: {
          '200': ok('Unregistered.', OK_ACK),
          ...authFailures(),
          '404': fail('No webhook with that id belongs to this shop.', ['not_found']),
        },
      },
    },
  },
} as const

export function GET() {
  return NextResponse.json(SPEC, {
    headers: {
      // Agents fetch this cold and rarely; an hour at the edge keeps a spec change visible the
      // same session while still absorbing a crawl.
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
