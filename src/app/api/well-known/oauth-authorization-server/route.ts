import { NextResponse } from 'next/server'
import { OAUTH_ISSUER, OAUTH_SCOPES } from '@/lib/api/oauth'

// ── RFC 8414 · OAuth 2.0 Authorization Server Metadata ────────────────────────────
// Served at /.well-known/oauth-authorization-server via a rewrite in next.config.ts. It lives
// under /api/well-known/ rather than public/.well-known/ for the same reason the AASA route
// does: the app router ignores dot-folders, so a literal `.well-known` directory in the app
// tree is never routed (public/.well-known/assetlinks.json works only because it is a static
// file served before routing).
//
// ⚠️ THIS DOCUMENTS AN ENDPOINT THAT ALREADY EXISTS — it does not create one. /api/v1/oauth/token
// has implemented RFC 6749 §4.4 client-credentials since the partner API shipped: an API key is
// exchanged for a short-lived HS256 JWT, and per-key scopes are enforced by resolveApiKey. The
// only thing missing was the discovery document, which is why an agent audit on 2026-08-23 read
// the API as having no OAuth at all ("OAuth mentioned in documentation but no OAuth or OpenID
// Connect endpoint responded") despite the grant being live and in the OpenAPI spec.
//
// ⛔ ADVERTISE ONLY WHAT THE ROUTE IMPLEMENTS. Every field below was checked against
// src/app/api/v1/oauth/token/route.ts, and the omissions are the load-bearing part:
//   · NO `authorization_endpoint` — there is no user-facing authorization step. A client acts for
//     ITS OWN shop with credentials it already holds; there is no resource owner to redirect.
//     Publishing one would send every conforming client to a 404 before it ever reached the token
//     endpoint, which is a worse failure than publishing nothing.
//   · NO `code_challenge_methods_supported` — PKCE protects an authorization CODE. There is no
//     code. Listing S256 here would be a claim about a flow this server cannot run.
//   · NO refresh_token in `grant_types_supported` — the token response contains access_token,
//     token_type, expires_in and scope, and nothing else. A client re-presents its key.
//   · NO `revocation_endpoint` / `introspection_endpoint` — tokens are STATELESS by design, so
//     there is nothing to revoke or introspect server-side. Revoking the underlying API key in the
//     dashboard takes effect within the 1-hour TTL; that is the documented model, not an oversight.
//
// ⚠️ `response_types_supported: []` IS CORRECT AND IS NOT A PLACEHOLDER. RFC 8414 lists the field
// as required, and the honest value for a server with no authorization endpoint is the empty list:
// it supports no response types because there is no request that could carry one. The alternative
// — omitting it, or worse padding it with "code" — either fails strict validators or lies.
//
// ⚠️ THE EDGE PIN DOES NOT REACH THIS. src/proxy.ts matches `/api/:path*` and the /api/well-known
// destination is NOT on its bypass list, but next.config rewrites are applied AFTER middleware, so
// the request middleware sees is `/.well-known/…` and never matches. Same mechanism that keeps the
// AASA route reachable. A DIRECT hit to /api/well-known/* would 403 once EDGE_SECRET is set — that
// is pre-existing and applies to AASA identically, and no published URL points there.

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(
    {
      // ⛔ MUST BE BYTE-IDENTICAL TO THE `iss` CLAIM WE MINT, which is why it is imported rather
      // than rebuilt here. RFC 8414 §3.3 also requires it to match the origin the document was
      // fetched from. Per edition: https://eno.vn (marketplace) / https://www.eno.forum (services),
      // asserted at build time by next.config.ts's host check.
      // ⚠️ KNOWN WRINKLE ON THE SERVICES EDITION: that host check is www-insensitive, so a client
      // fetching this document from the APEX https://eno.forum sees issuer https://www.eno.forum
      // and a strict validator will call it a mismatch. The apex 308s to www, so real clients
      // follow to the canonical host first; fixing it properly means canonicalising the env var,
      // not weakening the issuer.
      issuer: OAUTH_ISSUER,
      token_endpoint: `${OAUTH_ISSUER}/api/v1/oauth/token`,
      // RFC 6749 §4.4 is the ONLY grant implemented; the route rejects anything else with
      // `unsupported_grant_type` before it looks at credentials.
      grant_types_supported: ['client_credentials'],
      // readCredentials() tries HTTP Basic first and falls back to client_id/client_secret in the
      // form or JSON body — so BOTH methods are genuinely accepted, in that order of preference.
      // (client_id is optional in either method; when present it is compared to the key prefix in
      // constant time. There is no client_secret_jwt or private_key_jwt.)
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      // The scopes resolveApiKey actually enforces. A `scope` parameter on the token request may
      // NARROW a token to a subset of its key's scopes; it can never escalate (invalid_scope).
      scopes_supported: [...OAUTH_SCOPES],
      response_types_supported: [],
      // The tokens are HS256 JWTs, but they are OPAQUE to clients by contract — there is no JWKS
      // and no public key, because the signing key is symmetric and derived from a server secret.
      // Listing the alg here is informational only; do not add a `jwks_uri`, there is nothing
      // publishable behind one.
      service_documentation: `${OAUTH_ISSUER}/developers`,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        // Discovery metadata is build-constant and public. An hour keeps a client from re-fetching
        // per request while still letting a domain/issuer change propagate on the day it happens.
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
