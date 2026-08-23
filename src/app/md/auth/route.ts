import { OAUTH_SCOPES, TOKEN_TTL_SECONDS , TOKEN_RATE_PER_IP, TOKEN_RATE_PER_CLIENT, TOKEN_RATE_WINDOW_SEC } from '@/lib/api/oauth'
import { API_RATE_PER_MIN, API_RATE_WINDOW_SEC } from '@/lib/api/auth'
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
} satisfies Record<(typeof OAUTH_SCOPES)[number], string>

export async function GET() {
  const scopeRows = OAUTH_SCOPES.map((s) => `| \`${s}\` | ${SCOPE_NOTES[s]} |`).join('\n')

  const body = `# Authentication — ${SITE_NAME} Partner API

> Two credentials, one identity. A long-lived API key, or a short-lived OAuth 2.0 access token
> minted from that key. Both are sent as \`Authorization: Bearer …\` and both are accepted
> everywhere, including the MCP server.

One key acts for exactly one shop and only ever sees that shop's data. There is no user-facing
authorization step and no consent screen: a client acts for its own storefront with credentials it
already holds.

## 1. API key

\`\`\`
Authorization: Bearer eno_live_<32+ base62 characters>
\`\`\`

- Only a SHA-256 hash of the key is stored. The secret is shown once, at creation; if it is lost it
  cannot be recovered, only replaced.
- The first 16 characters are the key's **prefix** — it is displayed in the dashboard, it is the
  \`client_id\` for the token endpoint below, and it is not secret on its own.
- Revoking a key in the dashboard takes effect immediately for the key itself.

⚠️ The key format also admits an \`eno_test_\` namespace, but **no test keys are issued and there is
no sandbox**. Every documented request acts on real data in a real shop.

## 2. OAuth 2.0 access token (client credentials)

Use this when you would rather not put the long-lived key on the wire on every request.

\`\`\`
POST ${SITE_ORIGIN}/api/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

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

A success returns exactly four fields:

\`\`\`json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": ${TOKEN_TTL_SECONDS},
  "scope": "<space-separated granted scopes>"
}
\`\`\`

- There is **no refresh token**. When a token expires, present the key again.
- Tokens are **stateless** and opaque to you by contract. There is no introspection endpoint and no
  revocation endpoint, because there is nothing stored server-side to revoke. Revoking the
  underlying key in the dashboard therefore takes effect within ${TOKEN_TTL_SECONDS} seconds — keep
  that number in mind when you plan a key rotation.

### Token endpoint errors (RFC 6749 §5.2)

| Status | \`error\` | When |
| --- | --- | --- |
| 400 | \`unsupported_grant_type\` | \`grant_type\` is anything but \`client_credentials\`. Checked before credentials. |
| 401 | \`invalid_client\` | Missing or malformed \`client_secret\`, an unknown or revoked key, or a \`client_id\` that does not match the key. |
| 400 | \`invalid_scope\` | A requested scope the key does not hold. |
| 429 | \`invalid_request\` | Too many token requests. See the limits below. |
| 503 | \`temporarily_unavailable\` | Credential lookup or token signing is down. Retry. |

## 3. Scopes

| Scope | What it permits |
| --- | --- |
${scopeRows}

Scopes are enforced where the work happens, not at the door:

- On \`/api/v1\`, a request missing the scope its handler requires returns **403 \`insufficient_scope\`**.
- On \`/api/mcp\`, the connection authenticates with **no** required scope; each \`tools/call\` then
  checks the scope that tool declares. So a read-only key connects successfully and is refused at
  the call — that is the expected behaviour, not a bug.

## 4. Rate limits

| Surface | Limit | Keyed by |
| --- | --- | --- |
| \`/api/v1\` and \`/api/mcp\`, authenticated | ${API_RATE_PER_MIN} requests / ${API_RATE_WINDOW_SEC}s | the API key (a token shares its key's bucket) |
| \`POST /api/v1/oauth/token\` | ${TOKEN_RATE_PER_IP} / ${TOKEN_RATE_WINDOW_SEC}s | caller IP |
| \`POST /api/v1/oauth/token\` | ${TOKEN_RATE_PER_CLIENT} / ${TOKEN_RATE_WINDOW_SEC}s | \`client_id\` |

⚠️ The \`RateLimit\` headers on a token response describe the **token endpoint's own** policy, which
is deliberately far tighter than the API budget it hands out tokens for — it is the
credential-guessing surface. Do not infer your API quota from them — the table above states both
budgets. ([\`/api/v1/status\`](${SITE_ORIGIN}/api/v1/status) publishes the anonymous and the
authenticated budgets; the token endpoint's own policy is documented here and not there.)

## 5. Getting a key

Keys are issued in the dashboard, under **Developers**
([${SITE_ORIGIN}/dashboard/dev](${SITE_ORIGIN}/dashboard/dev)), to **business** accounts. That page
is the only place a key is created and the only place its secret is ever shown. There is no
self-serve API for minting keys and no application form: an account is upgraded to a business tier
first, and the Developers section appears once it is.

## 6. Discovery

- [\`/.well-known/oauth-authorization-server\`](${SITE_ORIGIN}/.well-known/oauth-authorization-server) — RFC 8414. The token endpoint, the grant, the scopes, the client auth methods.
- [\`/.well-known/oauth-protected-resource\`](${SITE_ORIGIN}/.well-known/oauth-protected-resource) — RFC 9728. Which resource a token is for, and which server issues it. Read this after a 401.
- [\`/.well-known/ai-catalog.json\`](${SITE_ORIGIN}/.well-known/ai-catalog.json) — the whole agentic surface in one document.
- [\`/openapi.json\`](${SITE_ORIGIN}/openapi.json) — OpenAPI 3.1, every endpoint and every error shape.
- [\`/agents.md\`](${SITE_ORIGIN}/agents.md) — what an agent can do here, with and without credentials.
- [\`/developers\`](${SITE_ORIGIN}/developers) — the same material for a human, with copy-pasteable requests.
`

  return markdownResponse(body)
}
