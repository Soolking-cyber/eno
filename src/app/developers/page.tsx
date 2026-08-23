import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Badge } from '@/components/ui/badge'
import { API_BASE, API_NAME, DISCOVERY, MEDIA_ORIGIN, SCOPES, SITE_ORIGIN, SUPPORT_EMAIL } from './reference'

/**
 * ⚠️ EVERY SELF-NAMING VALUE ON THIS PAGE COMES FROM ./reference, WHICH DERIVES IT FROM THE
 * EDITION. Read that file's header before typing a hostname, a scope or a support address here:
 * this component compiles into BOTH builds, and until 2026-08-23 it opened with a hardcoded
 * `const BASE = 'https://eno.vn/api/v1'` that made eno.forum's own documentation point partners
 * at the other deployment's API.
 *
 * ⚠️ THE TITLE LEADS WITH THE PRODUCT NAME, WHICH IS THE FIX, NOT A STYLE PREFERENCE. It read
 * "API for developers | eno.vn". An agent audit on 2026-08-23 searched for "eno" developer
 * resources and reported finding nothing relevant — a name-based query is matched against the
 * head of the title, and ours spent the first three words on generic vocabulary before reaching
 * the only distinctive token on the page. The <h1> had no product name at all ("Developer API"),
 * so the strongest heading on the site's only developer surface named neither product nor company.
 *
 * ⚠️ THIS PAGE IS A SERVER COMPONENT AND MUST STAY ONE. Its whole audience is machines that do
 * not execute JavaScript: an agent fetching the URL, a crawler indexing it. Marking it
 * `'use client'` would leave the useful half of the page in an RSC payload rather than in the
 * HTML, which is indistinguishable from the page not existing to everything that matters here.
 */

export const metadata: Metadata = {
  title: `${API_NAME} | Developer documentation`,
  description: `${API_NAME} — manage your shop programmatically over REST or MCP. Bearer keys or OAuth 2.0 client credentials, four scopes, OpenAPI 3.1 spec.`,
  alternates: { canonical: '/developers' },
}

const BASE = API_BASE

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-foreground/[0.04] p-3.5 text-xs leading-relaxed text-foreground ring-1 ring-border">
      <code className="font-mono">{children}</code>
    </pre>
  )
}

function Endpoint({ method, path, desc, children }: { method: string; path: string; desc: string; children?: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="brand" size="sm" className="rounded-lg font-mono">{method}</Badge>
        <code className="font-mono text-sm font-semibold text-foreground">{path}</code>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-body">{desc}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

export default function DevelopersPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 pt-10 pb-16 sm:px-6 lg:px-8">
        <p className="eyebrow text-accent-foreground mb-2">{SITE_NAME} API</p>
        <h1 className="h-display text-foreground">{API_NAME}</h1>
        <p className="mt-3 text-sm leading-relaxed text-body">
          Manage your {SITE_NAME} storefront programmatically — from your own systems or an AI agent. A REST API with
          bearer-key auth, supporting <strong className="text-foreground">read and write</strong>.
        </p>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Base URL</h2>
          <div className="mt-3"><Code>{BASE}</Code></div>
          <p className="mt-3 text-sm leading-relaxed text-body">
            Everything below is served from <strong className="text-foreground">{SITE_ORIGIN}</strong>. {SITE_NAME} and its
            sibling site run the same software on separate deployments, and they share one database — so a key issued
            by either one authenticates at both. Send requests to the host you got your key from anyway: that is the
            host whose catalogue and storefront the responses describe. Treat a key as a credential for your shop, not
            for a single hostname, and revoke it in the dashboard if it leaks.
          </p>
        </section>

        {/*
          ⚠️ REAL ANCHORS, NOT A PROSE MENTION — AND THE COUNT COMES FROM `DISCOVERY`, NOT FROM
          THIS COMMENT. It used to say "six" in three places while DISCOVERY rendered seven, because
          /api/v1/status was added after the prose was written; a reviewer caught the page whose
          whole pitch is machine-trustworthy precision miscounting its own list. Never hardcode the
          number again — render it.
          The audit that produced this section reported
          "searched for developer resources but found nothing relevant" while /openapi.json,
          /llms.txt, both .well-known documents and /sitemap.xml were all answering 200 on both
          deployments. Nothing linked to them from any page, and an <a href> is the only form of
          "this exists" that a crawler or an agent can follow. Each href is curled before it is
          written down — see the verification table in ./reference.
        */}
        <section className="mt-8">
          <h2 className="h-section text-foreground">Specs &amp; discovery</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            Machine-readable descriptions of this API. All {DISCOVERY.length} are public, need no credentials, and are served from this
            same origin.
          </p>
          <ul className="mt-4 space-y-3">
            {DISCOVERY.map((d) => (
              <li key={d.href} className="border-t border-border pt-3">
                <a href={d.href} className="font-mono text-sm font-semibold text-accent-foreground hover:underline">
                  {d.label}
                </a>
                <p className="mt-1 text-sm leading-relaxed text-body">{d.note}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-body">
            Nothing here requires an account. Together with <Code>GET /status</Code> below, this is what you can
            call before you have a key:
          </p>
          <div className="mt-3"><Code>{`curl ${SITE_ORIGIN}/openapi.json`}</Code></div>
        </section>

        <section className="mt-8 rounded-2xl bg-accent/40 p-5 ring-1 ring-border">
          <p className="eyebrow text-accent-foreground mb-1">New</p>
          <h2 className="h-section text-foreground">Manage your shop with AI (MCP)</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            {SITE_NAME} runs a hosted <a href="https://modelcontextprotocol.io" className="font-semibold text-accent-foreground hover:underline">Model Context Protocol</a> server,
            so an AI agent (Claude, etc.) can manage your storefront directly — list, create, edit, bulk-import, sync a catalogue,
            read analytics, and manage webhooks. Add it as a remote MCP server with your API key as the Bearer token:
          </p>
          {/* ⚠️ DERIVED, LIKE EVERY OTHER HOST HERE. This was `https://eno.vn/api/mcp` verbatim, so a
              forum partner pasting it into an MCP client pointed the agent at the other deployment
              and got a 401 it had no way to interpret. Verified 2026-08-23: GET /api/mcp answers 405
              (POST-only JSON-RPC) on BOTH origins, so the endpoint is real on both. */}
          <div className="mt-3"><Code>{`${SITE_ORIGIN}/api/mcp
Authorization: Bearer eno_live_…`}</Code></div>
          <p className="mt-3 text-sm leading-relaxed text-body">
            Your key stays in the client&apos;s connection settings — it is <strong className="text-foreground">never passed as a tool argument, so it never reaches the model</strong>.
            Tools are scoped exactly like the REST API (a read-only key exposes only the read tools). Available tools:
          </p>
          <p className="mt-2 text-sm leading-relaxed text-body font-mono">
            get_shop · update_shop · list_listings · get_listing · create_listing · update_listing · set_listing_status ·
            delete_listing · bulk_create_listings · sync_catalogue · analytics_summary · analytics_listings · list_webhooks ·
            register_webhook · delete_webhook
          </p>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Authentication</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            {/* ⚠️ /dashboard/dev, NOT /dashboard?tab=dev. The query form still resolves — dashboard/page.tsx
                keeps a TAB_TO_ROUTE map for bookmarked links — but it costs the reader a redirect and
                documents a legacy shape as the current one. The section pages became real routes in the
                nav-rail change; this link had not followed. */}
            Create a key in your <Link href="/dashboard/dev" className="font-semibold text-accent-foreground hover:underline">dashboard → Developers</Link> section
            (business accounts). The full secret is shown once — store it safely. Send it as a Bearer token on every request:
          </p>
          <div className="mt-3"><Code>{`Authorization: Bearer eno_live_…`}</Code></div>
          {/* ⚠️ RENDERED FROM `OAUTH_SCOPES`, THE CONSTANT THE TOKEN ENDPOINT ENFORCES AND BOTH
              .well-known DOCUMENTS ADVERTISE. Hand-typing the list is how a fifth scope ships
              undocumented, or a renamed one keeps being documented after it stops being accepted —
              and here the documentation and the metadata would then disagree in public. */}
          <p className="mt-3 text-sm leading-relaxed text-body">
            Keys are scoped:{' '}
            {SCOPES.map((s, i) => (
              <span key={s}>
                <code className="rounded-lg bg-muted px-1 text-xs font-semibold">{s}</code>
                {i < SCOPES.length - 1 ? ', ' : ' '}
              </span>
            ))}
            (write is opt-in when you mint the key). Every key acts for one shop; requests only ever see that shop&apos;s
            own data. Revoke a key anytime — it takes effect immediately. There is no sandbox and no test key: a key is
            live from the moment it is issued.
          </p>

          <h3 className="mt-6 text-xs font-bold uppercase tracking-wide text-ink-4">OAuth 2.0 (optional) — short-lived tokens</h3>
          <p className="mt-2 text-sm leading-relaxed text-body">
            Prefer not to put the long-lived key on every request? Exchange it for a 1-hour bearer token via the
            client-credentials grant — <code className="rounded-lg bg-muted px-1 text-xs font-semibold">client_id</code> is the
            key&apos;s prefix, <code className="rounded-lg bg-muted px-1 text-xs font-semibold">client_secret</code> is the full key.
            Optionally pass <code className="rounded-lg bg-muted px-1 text-xs">scope</code> to narrow the token (it can never
            exceed the key&apos;s scopes). The returned token works anywhere the key does, including the MCP server.
            Tokens last one hour. Credentials may go in the body as below, or in an HTTP Basic header.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-body">
            A client that would rather discover this than read it: the token endpoint, the one supported grant and the
            scope list are published at{' '}
            <a href="/.well-known/oauth-authorization-server" className="font-mono font-semibold text-accent-foreground hover:underline">/.well-known/oauth-authorization-server</a>,
            and the resource those tokens are for at{' '}
            <a href="/.well-known/oauth-protected-resource" className="font-mono font-semibold text-accent-foreground hover:underline">/.well-known/oauth-protected-resource</a>.
          </p>
          <div className="mt-3"><Code>{`curl -X POST ${BASE}/oauth/token \\
  -d grant_type=client_credentials \\
  -d client_id=eno_live_PREFIX -d client_secret=eno_live_FULLKEY

# → { "access_token": "eyJ…", "token_type": "Bearer", "expires_in": 3600, "scope": "listings:read analytics:read" }
# then:  Authorization: Bearer eyJ…`}</Code></div>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Conventions</h2>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-body">
            <li>• <strong className="text-foreground">Rate limit:</strong> 600 requests/min per key. Responses carry <code className="rounded-lg bg-muted px-1 text-xs">X-RateLimit-Limit</code> / <code className="rounded-lg bg-muted px-1 text-xs">X-RateLimit-Remaining</code> and an <code className="rounded-lg bg-muted px-1 text-xs">X-Request-Id</code>.</li>
            <li>• <strong className="text-foreground">Pagination:</strong> list endpoints are keyset-paged — pass <code className="rounded-lg bg-muted px-1 text-xs">?limit=</code> (≤100) and <code className="rounded-lg bg-muted px-1 text-xs">?cursor=</code>; follow <code className="rounded-lg bg-muted px-1 text-xs">next_cursor</code> until it&apos;s <code className="rounded-lg bg-muted px-1 text-xs">null</code>.</li>
            <li>• <strong className="text-foreground">Errors:</strong> <code className="rounded-lg bg-muted px-1 text-xs">{`{ "error": { "code", "message" } }`}</code> — e.g. <code className="rounded-lg bg-muted px-1 text-xs">401 unauthorized</code>, <code className="rounded-lg bg-muted px-1 text-xs">403 insufficient_scope</code>, <code className="rounded-lg bg-muted px-1 text-xs">404 not_found</code>, <code className="rounded-lg bg-muted px-1 text-xs">422 invalid_input</code>, <code className="rounded-lg bg-muted px-1 text-xs">429 rate_limited</code>.</li>
            <li>• <strong className="text-foreground">Idempotency:</strong> on a create, send <code className="rounded-lg bg-muted px-1 text-xs">Idempotency-Key: &lt;unique-id&gt;</code> — a retry replays the first result instead of creating twice.</li>
          </ul>
        </section>

        {/* ⚠️ PATHS HERE ARE RELATIVE TO `BASE`, WHICH ALREADY ENDS IN `/api/v1` — SO NO `/v1` PREFIX.
            They used to read `/v1/shop` while the Base URL block above renders `…/api/v1`, and the
            one thing a codegen or an agent does with those two strings is concatenate them:
            `https://eno.vn/api/v1` + `/v1/shop` = `/api/v1/v1/shop`, which 404s. The curl examples
            below were always correct because they interpolate BASE directly; only the labels lied,
            which is why a human reading the page never noticed. A reviewer caught it. */}
        <h2 className="mt-10 h-section text-foreground">Endpoints</h2>
        <div className="mt-4 space-y-6">
          <Endpoint method="GET" path="/status" desc="Service status and discovery. The only endpoint that needs NO credential — and the one to call first, because its RateLimit headers tell you the throttle before you have a key.">
            <Code>{`curl -i ${BASE}/status`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/shop" desc="Your storefront profile, trust score, and live listing count.">
            <Code>{`curl ${BASE}/shop \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "shop": { "id", "name", "bio", "location", "phone",
  "avatar_url", "trust_score", "trust_tier",
  "response_rate", "member_since", "active_listings" } }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/listings" desc="Your listings — ALL statuses (active, sold, hidden, held). Keyset-paginated.">
            <Code>{`curl "${BASE}/listings?limit=50" \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "listings": [ { "id", "title", "price", "status",
  "verified", "images", "category", … } ],
  "next_cursor": "eyJ…" | null }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/listings/{id}" desc="A single listing of yours, any status. 404 if it isn't yours.">
            <Code>{`curl ${BASE}/listings/LISTING_ID \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "listing": { "id", "title", "price", "status", … } }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/analytics/summary" desc="Shop rollup: total views + leads and listing counts by status.">
            <Code>{`curl ${BASE}/analytics/summary \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "summary": { "total_listings", "total_views",
  "total_leads", "active", "sold", "hidden", "held" } }`}</Code>
          </Endpoint>

          <h3 className="pt-4 text-xs font-bold uppercase tracking-wide text-ink-4">Write — scopes: listings:write / media:write</h3>

          <Endpoint method="POST" path="/listings" desc="Create a listing. Body: categorySlug, title, price + optional description, images[], district, condition, listingType, brand, model… Send an Idempotency-Key to make retries safe.">
            <Code>{`curl -X POST ${BASE}/listings \\
  -H "Authorization: Bearer eno_live_…" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"categorySlug":"electronics","title":"iPhone 14 Pro",
       "price":18000000,"images":["https://…/api/….webp"]}'`}</Code>
            <Code>{`{ "listing": { "id", "verified" } }`}</Code>
          </Endpoint>

          <Endpoint method="PATCH" path="/listings/{id}" desc="Edit a listing (sparse — only the fields you send change).">
            <Code>{`curl -X PATCH ${BASE}/listings/LISTING_ID \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"price":16500000,"condition":"used"}'`}</Code>
          </Endpoint>

          <Endpoint method="POST" path="/listings/{id}/status" desc="Set availability: active | sold | hidden.">
            <Code>{`curl -X POST ${BASE}/listings/LISTING_ID/status \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"status":"sold"}'`}</Code>
          </Endpoint>

          <Endpoint method="DELETE" path="/listings/{id}" desc="Remove a listing.">
            <Code>{`curl -X DELETE ${BASE}/listings/LISTING_ID \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
          </Endpoint>

          <Endpoint method="POST" path="/media" desc="Upload an image (multipart `file`, or a raw JPEG/PNG/WebP body). Returns a first-party URL to use in images[]. Scope: media:write.">
            <Code>{`curl -X POST ${BASE}/media \\
  -H "Authorization: Bearer eno_live_…" \\
  -F file=@photo.jpg`}</Code>
            {/* ⚠️ NOT `…supabase.co`. That was the RETIRED Supabase Cloud project; media has been
                served from the self-hosted stack since the 2026-08-22 cutover, and this page is the
                one a partner copies a URL shape from. A reviewer caught it still advertising the
                dead host on a page the same change set was rewriting to be edition-correct. */}
            <Code>{`{ "url": "${MEDIA_ORIGIN}/storage/v1/object/public/listings/….webp" }`}</Code>
          </Endpoint>

          <Endpoint method="PATCH" path="/shop" desc="Edit your storefront profile (name, bio, location, avatarUrl, phone).">
            <Code>{`curl -X PATCH ${BASE}/shop \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"bio":"Authorized reseller in District 1"}'`}</Code>
          </Endpoint>

          <h3 className="pt-4 text-xs font-bold uppercase tracking-wide text-ink-4">Bulk &amp; catalogue sync — scope: listings:write</h3>

          <Endpoint method="POST" path="/listings/bulk" desc="Create up to 200 listings in one call. Each row is independent (one bad row never aborts the batch); remote image URLs are re-hosted. Send an Idempotency-Key so a retry can't import twice. Returns per-row results.">
            <Code>{`curl -X POST ${BASE}/listings/bulk \\
  -H "Authorization: Bearer eno_live_…" \\
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \\
  -d '{"listings":[
        {"categorySlug":"electronics","title":"iPhone 14","price":15000000,
         "images":["https://your-cdn/iphone.jpg"],"externalId":"SKU-1"},
        {"categorySlug":"electronics","title":"AirPods Pro","price":4500000}
      ]}'`}</Code>
            <Code>{`{ "created": 2, "failed": 0, "image_budget_reached": false,
  "results": [ { "row": 1, "id": "…", "external_id": "SKU-1", "error": null }, … ] }`}</Code>
          </Endpoint>

          <Endpoint method="POST" path="/listings/sync" desc="Upsert your catalogue by your OWN id (externalId, unique per shop) — create new SKUs, update existing ones in place. mode: 'partial' (default) only touches the rows you send; 'full' also RETIRES (hides) any active listing whose externalId is NOT in the payload, so your storefront mirrors your system. Naturally idempotent. Up to 200 rows.">
            <Code>{`curl -X POST ${BASE}/listings/sync \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"mode":"full","listings":[
        {"externalId":"SKU-1","categorySlug":"electronics","title":"iPhone 14",
         "price":14500000,"status":"active","images":["https://your-cdn/iphone.jpg"]},
        {"externalId":"SKU-2","categorySlug":"electronics","title":"iPad Air","price":12000000}
      ]}'`}</Code>
            <Code>{`{ "mode": "full", "created": 1, "updated": 1, "retired": 3, "failed": 0,
  "results": [ { "external_id": "SKU-1", "id": "…", "action": "updated" }, … ] }`}</Code>
          </Endpoint>

          <h3 className="pt-4 text-xs font-bold uppercase tracking-wide text-ink-4">Per-listing analytics — scope: analytics:read</h3>

          <Endpoint method="GET" path="/analytics/listings" desc="Daily views + leads (per-day deltas) for each of your listings over a date range, plus current totals. Keyset-paginated by listing. ?from=YYYY-MM-DD&to=YYYY-MM-DD (default last 30 days, max 92).">
            <Code>{`curl "${BASE}/analytics/listings?from=2026-06-01&to=2026-06-29&limit=50" \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "range": { "from", "to" },
  "listings": [ { "id", "external_id", "title", "status",
    "views_total", "leads_total",
    "daily": [ { "day": "2026-06-28", "views": 12, "leads": 1 }, … ] } ],
  "next_cursor": "eyJ…" | null }`}</Code>
          </Endpoint>

          <h3 className="pt-4 text-xs font-bold uppercase tracking-wide text-ink-4">Webhooks — scope: listings:write (register) / listings:read (list)</h3>

          <Endpoint method="POST" path="/webhooks" desc="Register an HTTPS endpoint to receive SIGNED listing events (listing.created / .updated / .status_changed / .deleted), or pass events:'*' for all. The signing secret is returned ONCE — store it. Up to 10 endpoints per shop. The url must be a public HTTPS address.">
            <Code>{`curl -X POST ${BASE}/webhooks \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"url":"https://your-app/webhooks/eno","events":["listing.created","listing.updated"]}'`}</Code>
            <Code>{`{ "webhook": { "id", "url", "events": ["listing.created","listing.updated"],
  "enabled": true, "created_at", "secret": "whsec_…" } }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/webhooks" desc="List your registered webhook endpoints (secrets are never returned). Shows delivery health: failure_count, last_error, last_delivery_at. An endpoint auto-disables after repeated failures.">
            <Code>{`curl ${BASE}/webhooks -H "Authorization: Bearer eno_live_…"`}</Code>
          </Endpoint>

          <Endpoint method="DELETE" path="/webhooks/{id}" desc="Unregister a webhook endpoint.">
            <Code>{`curl -X DELETE ${BASE}/webhooks/WEBHOOK_ID -H "Authorization: Bearer eno_live_…"`}</Code>
          </Endpoint>

          <section className="border-t border-border pt-6">
            <p className="text-sm leading-relaxed text-body">
              <strong className="text-foreground">Verifying webhooks.</strong> Deliveries follow the{' '}
              <a href="https://www.standardwebhooks.com" className="font-semibold text-accent-foreground hover:underline">Standard Webhooks</a>{' '}
              spec, so any off-the-shelf verifier works. Each POST carries <code className="rounded-lg bg-muted px-1 text-xs">webhook-id</code>,{' '}
              <code className="rounded-lg bg-muted px-1 text-xs">webhook-timestamp</code> and{' '}
              <code className="rounded-lg bg-muted px-1 text-xs">webhook-signature</code> (<code className="rounded-lg bg-muted px-1 text-xs">v1,&lt;base64&gt;</code>) — an
              HMAC-SHA256 of <code className="rounded-lg bg-muted px-1 text-xs">{`${'${id}.${timestamp}.${body}'}`}</code> keyed by your <code className="rounded-lg bg-muted px-1 text-xs">whsec_</code> secret. Reject anything that doesn&apos;t verify.
            </p>
            <div className="mt-3"><Code>{`{ "id": "msg_…", "type": "listing.updated",
  "created_at": "2026-06-29T…Z",
  "data": { "listing_id": "…", "status": "sold" } }`}</Code></div>
          </section>
        </div>

        <p className="mt-10 border-t border-border pt-6 text-sm text-body">
          {/* ⚠️ COMPANY.email VIA ./reference, NOT A LITERAL — the same fix the footer records at
              its own mailto. This read `support@eno.vn` on both editions, so eno.forum's developer
              page sent its partners to the other operator's inbox. */}
          Questions or need write access early? <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent-foreground hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      </main>
      <Footer />
    </div>
  )
}
