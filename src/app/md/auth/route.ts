import { SIGN_IN_SCOPES, TOKEN_TTL_SECONDS , TOKEN_RATE_PER_IP, TOKEN_RATE_PER_CLIENT, TOKEN_RATE_WINDOW_SEC } from '@/lib/api/oauth'
import { ANON_RATE_PER_MIN, API_RATE_PER_MIN, API_RATE_WINDOW_SEC } from '@/lib/api/auth'
import { CODE_TTL_SECONDS, CONSENT_TTL_SECONDS, DEFAULT_SIGN_IN_SCOPES, GRANT_MAX_AGE_SECONDS, MCP_RESOURCE } from '@/lib/api/oauth-grant'
import {
  ATTEMPT_TTL_SECONDS, CLAIM_GRANT, CLAIM_PATH, IDENTITY_PATH, IDENTITY_RATE_PER_IP, JWT_BEARER_GRANT, MAX_ATTEMPTS,
  POLL_INTERVAL_SECONDS, REGISTRATION_TTL_SECONDS, VERIFICATION_PATH,
} from '@/lib/api/agent-auth'
import { SITE_NAME } from '@/lib/edition'
import { markdownResponse, SITE_ORIGIN } from '../markdown-response'

/**
 * `/auth.md` — how a machine authenticates here, reached by an `afterFiles` rewrite in
 * next.config.ts (`/auth.md` -> `/md/auth`).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * nginx's log for the 2026-08-23T11:39Z agent-audit scan shows `/auth.md` fetched 14 times and
 * answered 404 every time, alongside `/agents.md` and `/index.md` (15 each). The auth model is
 * already described in three machine-readable places — the OpenAPI spec, RFC 8414 metadata, RFC
 * 9728 metadata — and in one human place, /developers. What was missing is the shape an agent
 * probes for by convention: a short markdown document at a guessable path.
 *
 * ⛔ EVERY FACT BELOW WAS READ OUT OF THE CODE THAT ENFORCES IT, AND THE CONSTANTS ARE IMPORTED
 * RATHER THAN RETYPED. `src/app/api/v1/oauth/token/route.ts` for the grant, the credential readers
 * and each error code; `src/lib/api/auth.ts` for the key format, the scope check and the rate
 * limit; `src/lib/api/oauth.ts` for the TTL and the scope list. A document that tells a partner
 * something the server does not do is worse than no document: they will build against it and the
 * failure will surface as a 4xx they cannot explain.
 *
 * ── THE STEP ORDER IS THE auth.md CONVENTION'S (2026-11-16) ─────────────────────────────────────────────────────────
 * github.com/workos/auth.md lays an auth.md out as discover → pick a method → register → claim → exchange → use → errors →
 * revocation, and ora.ai scores that structure. The facts are unchanged in kind — still read out of the code — but the
 * document now also covers "Sign in with eno" (authorization code + PKCE, refresh rotation: src/lib/api/oauth-grant.ts),
 * which it had not since 11-14 and wrongly said had "no refresh token" and "no consent screen". ⛔ Where eno has no
 * equivalent of a step (anonymous or ID-JAG registration, a revocation endpoint), the step SAYS SO — it never names an
 * endpoint that does not answer. Since 2026-11-16 agent registration exists: the `service_auth` claim ceremony
 * (src/lib/api/agent-auth.ts), with its `agent_auth` block in the AS metadata.
 *
 * ⚠️ THIS IS EDITION-NEUTRAL BY CONSTRUCTION, WHICH IS WHY IT NEEDS NO GATE. The partner API, the
 * token endpoint, the MCP server and both .well-known documents are served IDENTICALLY by eno.vn
 * and eno.forum (curled, 200 on every path on both hosts, 2026-08-23) — one Postgres, one
 * `resolveApiKey`, no host predicate. Nothing here names a service either edition may not offer,
 * and every URL is interpolated from SITE_ORIGIN so each deployment names only itself.
 */
export const dynamic = 'force-dynamic'

/**
 * ⚠️ ONE SENTENCE PER SCOPE, PAIRED WITH THE CONSTANT SO THE TWO CANNOT DRIFT APART. `OAUTH_SCOPES`
 * is harvested from the 17 guarded /api/v1 handlers (see its note); this map only supplies prose.
 * The `satisfies` makes a scope added there without a sentence here a TYPE ERROR rather than a
 * silently undocumented permission.
 */
const SCOPE_NOTES = {
  'listings:read': 'Read the shop, its listings (any status) and its webhook registrations.',
  'listings:write': 'Create, edit, delete and re-status listings; bulk-import; sync a catalogue; register and remove webhooks.',
  'analytics:read': 'Read shop-level totals and per-listing daily views and leads.',
  'media:write': 'Upload an image to first-party storage and get back a URL to put in a listing\'s images[]. Attaching it to a listing is a listings:write call.',
  'ads:write': 'Submit an ad creative (a picture, a headline and a landing page) for eno\'s review, and buy its run in the feed over x402 once approved. Never granted by default: ask for it.',
  'messages:read': 'Sign-in only, MCP only, any account (no shop needed: asked alone, it connects the person, not a shop): read the person\'s conversations (the inbox and each thread\'s messages and offers). Reading never marks a thread as read.',
  'messages:write': 'Sign-in only, MCP only: message a seller about a listing, reply, make or counter an offer, and decline an offer, in the person\'s name; each message is marked as written by an AI assistant. An offer it makes is the person\'s: the other side may accept it. Accepting an offer stays with the person, in the app.',
} satisfies Record<(typeof SIGN_IN_SCOPES)[number], string>

export async function GET() {
  const scopeRows = SIGN_IN_SCOPES.map((s) => `| \`${s}\` | ${SCOPE_NOTES[s]} |`).join('\n')

  const body = `# ${SITE_NAME} auth.md — authentication for the Partner API

> Four ways in, one shop per credential: a long-lived API key, a short-lived OAuth 2.0 access token
> minted from that key (client credentials), "Sign in with ${SITE_NAME}" (OAuth 2.1 authorization
> code with PKCE) for an MCP client a shop owner connects, or **agent registration** — an AI agent
> that knows only its person's email asks, and the person types a code on ${SITE_NAME}. Every one is
> sent as \`Authorization: Bearer …\`.

A credential acts for exactly one shop and only ever sees that shop's data. The steps below follow the
order of the [auth.md convention](https://github.com/workos/auth.md) — discover, pick a method,
register, claim, exchange, use, errors, revocation. Where ${SITE_NAME} has no equivalent of a step, the
step says so rather than leaving you to probe for it.

## Step 1 — Discover

### 1a. Protected Resource Metadata (RFC 9728)

- [\`/.well-known/oauth-protected-resource/api/v1\`](${SITE_ORIGIN}/.well-known/oauth-protected-resource/api/v1) — the REST API (\`${SITE_ORIGIN}/api/v1\`).
- [\`/.well-known/oauth-protected-resource/api/mcp\`](${SITE_ORIGIN}/.well-known/oauth-protected-resource/api/mcp) — the MCP server (\`${MCP_RESOURCE}\`).

A call to an \`/api/v1\` endpoint that needs a credential, sent without one, answers \`401\` with
\`WWW-Authenticate: Bearer realm="…", resource_metadata="${SITE_ORIGIN}/.well-known/oauth-protected-resource/api/v1"\`.

### 1b. Authorization Server metadata (RFC 8414)

[\`/.well-known/oauth-authorization-server\`](${SITE_ORIGIN}/.well-known/oauth-authorization-server) — the
issuer, the token endpoint, the authorization endpoint, the grants (\`client_credentials\`,
\`authorization_code\`, \`refresh_token\`, \`${CLAIM_GRANT}\`, \`${JWT_BEARER_GRANT}\`), PKCE
\`S256\`, client ID metadata documents, the scopes, and the **\`agent_auth\`** block:

\`\`\`json
"agent_auth": {
  "skill": "${SITE_ORIGIN}/auth.md",
  "identity_endpoint": "${SITE_ORIGIN}${IDENTITY_PATH}",
  "claim_endpoint": "${SITE_ORIGIN}${CLAIM_PATH}",
  "identity_types_supported": ["service_auth"]
}
\`\`\`

⚠️ Only **\`service_auth\`** (the verified-email claim ceremony). An agent cannot register here
anonymously or with an identity assertion from an agent provider (ID-JAG): no provider is trusted, so
there is no \`identity_assertion\` block and no \`events_endpoint\`.

## Step 2 — Pick a method

| Method | For | What you hold |
| --- | --- | --- |
| API key | a shop's own scripts and servers | \`eno_live_…\` from Dashboard › Developers |
| Client credentials | the same, without the long-lived key on every request | the key, exchanged for a ${TOKEN_TTL_SECONDS}-second token |
| Sign in with ${SITE_NAME} | an MCP client (Claude, ChatGPT and similar) a shop owner connects | a refresh token from the owner's consent; MCP only |
| Agent registration (\`service_auth\`) | an AI agent that knows its person's email and cannot open a browser redirect | an \`identity_assertion\` after the person types your code on ${SITE_NAME}; MCP only |

## Step 3 — Register

**API keys.** Keys are issued in the dashboard, under **Developers**
([${SITE_ORIGIN}/dashboard/settings?tab=developers](${SITE_ORIGIN}/dashboard/settings?tab=developers)), to **business** accounts. That page is
the only place a key is created and the only place its secret is ever shown. There is no self-serve API
for minting keys and no application form: an account is upgraded to a business tier first, and the
Developers section appears once it is.

\`\`\`
Authorization: Bearer eno_live_<32+ base62 characters>
\`\`\`

- Only a SHA-256 hash of the key is stored. The secret is shown once, at creation; if it is lost it
  cannot be recovered, only replaced.
- The first 16 characters are the key's **prefix** — it is displayed in the dashboard, it is the
  \`client_id\` for the client-credentials grant, and it is not secret on its own.

⚠️ An \`eno_test_\` key is a **sandbox** key: \`POST ${SITE_ORIGIN}/api/v1/sandbox/keys\` issues one to anyone,
with no account, for 24 hours. It works only under /api/v1/sandbox (sample data, nothing stored) and every live
endpoint refuses it. Every other documented request acts on real data in a real shop.

**Sign-in clients.** There is no registration call and no client table: a client identifies itself with a
**client ID metadata document** — its \`client_id\` is an \`https\` URL that serves its own metadata,
including the \`redirect_uris\` it may return to. Dynamic client registration is not offered.

**Agents (\`service_auth\`).** Register with the email of the ${SITE_NAME} account you act for:

\`\`\`
POST ${SITE_ORIGIN}${IDENTITY_PATH}
Content-Type: application/json

{ "type": "service_auth", "login_hint": "owner@example.com" }
\`\`\`

\`\`\`json
{
  "registration_id": "reg_…",
  "registration_type": "service_auth",
  "claim_url": "${CLAIM_PATH}",
  "claim_token": "clm_…",
  "claim_token_expires": "<${REGISTRATION_TTL_SECONDS / 60} minutes from now>",
  "post_claim_scopes": ${JSON.stringify(DEFAULT_SIGN_IN_SCOPES)},
  "claim": { "user_code": "123456", "verification_uri": "${SITE_ORIGIN}${VERIFICATION_PATH}", "expires_in": ${ATTEMPT_TTL_SECONDS}, "interval": ${POLL_INTERVAL_SECONDS} }
}
\`\`\`

- Every well-formed email gets this same answer, whether or not it has an account: who can connect is
  decided by the signed-in person on ${SITE_NAME}, never told to the agent.
- Keep \`claim_token\` secret; it is shown once. At most ${IDENTITY_RATE_PER_IP} registrations per hour per
  caller IP (\`429 rate_limited\` with \`Retry-After\`).
- Any other \`type\` returns \`400 unsupported_identity_type\`; a bad \`login_hint\`, \`400 invalid_request\`.

## Step 4 — Claim

**Agents.** Show your person the \`user_code\` and the \`verification_uri\`. They open
\`${SITE_ORIGIN}${VERIFICATION_PATH}\` themselves, signed in to ${SITE_NAME} with the email you registered, type
the code, see their shop and the access you ask for, and press **Allow**. The address carries no request on
purpose: send the code and the address, never a link with the code in it.

- A code lives ${ATTEMPT_TTL_SECONDS / 60} minutes. For a new one while the registration is open
  (${REGISTRATION_TTL_SECONDS / 60} minutes), \`POST ${SITE_ORIGIN}${CLAIM_PATH}\` with
  \`{ "claim_token": "clm_…", "email": "<the same login_hint>" }\`: the old code stops working; at most
  ${MAX_ATTEMPTS} codes per registration.
- Only the owner of a shop on a **business** account that is not held or suspended can allow it, and
  only when their account's confirmed email is the one you registered.

**Sign-in clients.** The human step is the
**consent page** at \`${SITE_ORIGIN}/oauth/authorize\`: the shop owner, signed in to ${SITE_NAME}, sees which
app is asking and for which scopes, and allows or refuses it.

\`\`\`
GET ${SITE_ORIGIN}/oauth/authorize?response_type=code
  &client_id=<your client ID metadata URL>
  &redirect_uri=<one of its redirect_uris>
  &code_challenge=<BASE64URL(SHA-256(code_verifier))>&code_challenge_method=S256
  &scope=<optional, space-separated>&resource=${MCP_RESOURCE}&state=<yours>
\`\`\`

- Only \`response_type=code\` and PKCE \`S256\` are accepted. \`resource\` may be omitted; the only
  resource is \`${MCP_RESOURCE}\`.
- Without \`scope\` the request asks for \`${DEFAULT_SIGN_IN_SCOPES.join(' ')}\`.
- Only the owner of a shop on a **business** account that is not held or suspended can allow it.
- The consent page is valid for ${CONSENT_TTL_SECONDS} seconds; the code it returns lives
  ${CODE_TTL_SECONDS} seconds and works once. A refusal returns \`error=access_denied\`.

## Step 5 — Exchange

All five grants use one endpoint:

\`\`\`
POST ${SITE_ORIGIN}/api/v1/oauth/token
Content-Type: application/x-www-form-urlencoded
\`\`\`

### 5a. Client credentials (API key)

\`\`\`
grant_type=client_credentials
&client_id=<the key prefix>
&client_secret=<the full eno_live_ key>
&scope=<optional, space-separated>
\`\`\`

- Credentials may be sent as **HTTP Basic** (preferred, tried first) or in the body. The body may be
  form-urlencoded or JSON.
- \`client_id\` is **optional**. When present it is compared to the key's prefix in constant time and
  a mismatch is rejected.
- \`scope\` may only **narrow** the token to a subset of the key's scopes. It can never escalate; an
  unheld scope returns \`invalid_scope\`.

A success returns exactly four fields — there is **no refresh token** on this grant. When the token
expires, present the key again.

\`\`\`json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": ${TOKEN_TTL_SECONDS},
  "scope": "<space-separated granted scopes>"
}
\`\`\`

### 5b. Authorization code (Sign in with ${SITE_NAME})

\`\`\`
grant_type=authorization_code
&code=<from the redirect>&code_verifier=<the PKCE verifier>
&redirect_uri=<the same one as the request>&client_id=<your client ID metadata URL>
\`\`\`

The answer carries the same four fields plus a \`refresh_token\` (\`eno_rt_…\`).

### 5c. Refresh token

\`\`\`
grant_type=refresh_token&refresh_token=<eno_rt_…>&client_id=<your client ID metadata URL>
\`\`\`

- Each refresh **rotates** the refresh token: use the new one. Presenting an old one again (from the client it
  was issued to) is treated as a replay and **revokes the whole connection**.
- A refresh may send a narrower \`scope\`: that narrows only the access token in that answer. The
  connection's scopes never change, so the next refresh without \`scope\` gets the full set again; a scope
  outside the connection returns \`invalid_scope\`. To give a scope up for good, revoke the connection and
  sign in again with less.
- A connection ends ${GRANT_MAX_AGE_SECONDS / 86400} days after the owner allowed it, however often it is
  refreshed; then the owner signs in again.

### 5d. Agent claim poll

\`\`\`
grant_type=${CLAIM_GRANT}&claim_token=<clm_…>
\`\`\`

Poll every \`interval\` (${POLL_INTERVAL_SECONDS} s) until the person answers:

| \`error\` | Meaning |
| --- | --- |
| \`authorization_pending\` | Not answered yet. Keep polling. |
| \`slow_down\` | Faster than \`interval\`. Add ${POLL_INTERVAL_SECONDS} seconds. |
| \`access_denied\` | The person pressed Cancel. Stop. |
| \`expired_token\` | The registration is unknown or past its ${REGISTRATION_TTL_SECONDS / 60} minutes. Register again. |
| \`invalid_grant\` | Already collected (see below), or the shop can no longer be connected. |

Once allowed, the poll answers the four fields of 5a plus \`identity_assertion\` (\`eno_ia_…\`) and
\`assertion_expires\`. ⚠️ **It answers once.** A claim_token presented again after that is a replay: the
connection is ended. If you lose that answer, register again.

### 5e. Agent refresh (jwt-bearer)

\`\`\`
grant_type=${JWT_BEARER_GRANT}&assertion=<identity_assertion>&scope=<optional, narrower>
\`\`\`

- The \`identity_assertion\` is an **opaque** secret issued here (not a JWT you can read or an ID-JAG):
  re-present the same one for each new access token until \`assertion_expires\`. There is no
  \`refresh_token\` on the agent grants.
- Assertions from agent providers (ID-JAGs) are not accepted: \`invalid_grant\`.
- Every exchange checks the connection again: revoked, past ${GRANT_MAX_AGE_SECONDS / 86400} days, or a shop that
  can no longer be connected → \`invalid_grant\`; then register again.

## Step 6 — Use the access_token

\`\`\`
Authorization: Bearer <access_token or API key>
\`\`\`

| Scope | What it permits |
| --- | --- |
${scopeRows}

- An API key and a client-credentials token work on \`/api/v1\` and on \`/api/mcp\`. A **sign-in token**
  — and an **agent's** — is issued for \`${MCP_RESOURCE}\` only (its \`aud\`) and is refused on \`/api/v1\`.
- On \`/api/v1\`, a request missing the scope its handler requires returns **403 \`insufficient_scope\`**.
- On \`/api/mcp\`, the connection authenticates with **no** required scope; each \`tools/call\` then
  checks the scope that tool declares. So a read-only key connects successfully and is refused at
  the call — that is the expected behaviour, not a bug.

| Surface | Limit | Keyed by |
| --- | --- | --- |
| \`/api/v1\` and \`/api/mcp\`, authenticated | ${API_RATE_PER_MIN} requests / ${API_RATE_WINDOW_SEC}s | the credential: an API key and the tokens minted from it share one bucket; each sign-in connection has its own |
| \`POST /api/v1/oauth/token\` | ${TOKEN_RATE_PER_IP} / ${TOKEN_RATE_WINDOW_SEC}s | caller IP |
| \`POST /api/v1/oauth/token\`, client credentials only | ${TOKEN_RATE_PER_CLIENT} / ${TOKEN_RATE_WINDOW_SEC}s | \`client_id\` (the key prefix) — the sign-in grants are limited per IP only, since a sign-in client's id is public |
| \`POST ${IDENTITY_PATH}\` | ${IDENTITY_RATE_PER_IP} / hour | caller IP |
| Agent claim poll | one per ${POLL_INTERVAL_SECONDS}s | the registration (\`slow_down\`) |

⚠️ The \`RateLimit\` headers on a token response describe the **token endpoint's own** policy, which
is deliberately far tighter than the API budget it hands out tokens for — it is the
credential-guessing surface. Do not infer your API quota from them — the table above states both
budgets. ([\`/api/v1/status\`](${SITE_ORIGIN}/api/v1/status) publishes the authenticated budget and its
own per-IP limit; an unauthenticated \`/api/v1\` call is limited to ${ANON_RATE_PER_MIN} per minute per IP;
the token endpoint's own policy is documented here and not there.)

## Errors

Token endpoint (RFC 6749 §5.2):

| Status | \`error\` | When |
| --- | --- | --- |
| 400 | \`unsupported_grant_type\` | \`grant_type\` is none of the five in Step 5. Checked before credentials. |
| 401 | \`invalid_client\` | Client credentials: missing or malformed \`client_secret\`, an unknown or revoked key, or a \`client_id\` that does not match the key. |
| 400 | \`invalid_request\` | A sign-in grant without \`client_id\`. (A \`client_id\` the code or refresh token was not issued to is \`invalid_grant\`.) |
| 400 | \`invalid_grant\` | A code that is wrong, expired, already used or issued to another client or site; a PKCE verifier or \`redirect_uri\` that does not match; a refresh token that is invalid, replayed or revoked; a connection that has expired or no longer exists; a shop that can no longer be connected (its owner held or suspended, off the business tier, or without the shop). |
| 400 | \`invalid_target\` | The sign-in grants only (client credentials ignores \`resource\`): a \`resource\` other than \`${MCP_RESOURCE}\` (a trailing slash is accepted). At \`/oauth/authorize\` the same error is shown on ${SITE_NAME}'s page and never sent back to the app. |
| 400 | \`invalid_scope\` | A scope the key does not hold, or a refresh that asks for a scope outside the connection. |
| 429 | \`invalid_request\` | Too many token requests. See the limits above. |
| 503 | \`temporarily_unavailable\` | Credential lookup or token signing is down. Retry. |

The REST API answers \`401\` with the \`WWW-Authenticate\` header of Step 1a when no valid credential is
sent, and \`403 insufficient_scope\` when the credential lacks the scope.

## Revocation

**A sign-in's refresh token** can be revoked by its client with RFC 7009 at
\`${SITE_ORIGIN}/api/v1/oauth/revoke\` (\`token\`, \`token_type_hint=refresh_token\`, \`client_id\`): \`200\` ends the
connection, and its access tokens stop at once (each call checks the connection). An unknown or already revoked token
also answers \`200\`; a token issued to another client is \`unauthorized_client\`; an access token is
\`unsupported_token_type\` (revoke the refresh token instead). There is no introspection endpoint. Everything can also be
revoked in Dashboard › Developers:

- **An API key**: revoking it stops the key at once. Client-credentials tokens are stateless, so one
  already minted from it keeps working until it expires, within ${TOKEN_TTL_SECONDS} seconds — keep
  that number in mind when you plan a key rotation.
- **A connected app** (a sign-in): it is a row in the same API-key list, named "<app> (signed in
  YYYY-MM-DD)" with an \`oag_\` prefix. **Revoke** it there, and its refresh token and its access tokens
  stop at once — a sign-in token is checked against its connection on every call. A suspension, leaving
  the business tier or losing the shop ends a connection the same way.
- **A connected agent** (agent registration): the same list, named "AI agent (connected YYYY-MM-DD)".
  Revoking it ends its \`identity_assertion\` and its access tokens at once. The owner is told in
  ${SITE_NAME}'s notifications whenever an agent is connected.

## Discovery documents

- [\`/.well-known/oauth-authorization-server\`](${SITE_ORIGIN}/.well-known/oauth-authorization-server) — RFC 8414.
- [\`/.well-known/oauth-protected-resource\`](${SITE_ORIGIN}/.well-known/oauth-protected-resource) — RFC 9728 for the origin (\`${SITE_ORIGIN}\`): the same authorization server and scopes as the two resource documents in Step 1. After a 401, read the one its challenge names.
- [\`/.well-known/ai-catalog.json\`](${SITE_ORIGIN}/.well-known/ai-catalog.json) — the whole agentic surface in one document.
- [\`/openapi.json\`](${SITE_ORIGIN}/openapi.json) — OpenAPI 3.1, every endpoint and every error shape.
- [\`/agents.md\`](${SITE_ORIGIN}/agents.md) — what an agent can do here, with and without credentials.
- [\`/developers\`](${SITE_ORIGIN}/developers) — the same material for a human, with copy-pasteable requests.
`

  /**
   * ⛔ NO FRONTMATTER ON /auth.md (measured 2026-11-16): ora's `auth-md-exists` check reads it as markdown only when it OPENS
   * WITH A HEADING — with the `---` block on top it failed ("does not look like markdown (no leading heading)") and the scan
   * lost 2 points. /index.md and /agents.md keep their block (withFrontmatter, ../markdown-response).
   */
  return markdownResponse(body)
}
