import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'

export const metadata: Metadata = {
  title: 'API for developers | eno.vn',
  description: 'The eno.vn partner API — manage your shop programmatically. REST, API-key auth, read-only v1.',
}

const BASE = 'https://eno.vn/api/v1'

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
        <span className="rounded-lg bg-accent px-2 py-0.5 font-mono text-2xs font-bold text-accent-foreground">{method}</span>
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
        <p className="eyebrow text-accent-foreground mb-2">eno.vn API</p>
        <h1 className="h-display text-foreground">Developer API</h1>
        <p className="mt-3 text-sm leading-relaxed text-body">
          Manage your eno.vn storefront programmatically — from your own systems or an AI agent. A REST API with API-key
          auth, supporting <strong className="text-foreground">read and write</strong>.
        </p>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Base URL</h2>
          <div className="mt-3"><Code>{BASE}</Code></div>
          <p className="mt-3 text-sm leading-relaxed text-body">
            Machine-readable <a href="/api/v1/openapi.json" className="font-semibold text-accent-foreground hover:underline">OpenAPI 3.1 spec</a> for client codegen.
          </p>
        </section>

        <section className="mt-8 rounded-2xl bg-accent/40 p-5 ring-1 ring-border">
          <p className="eyebrow text-accent-foreground mb-1">New</p>
          <h2 className="h-section text-foreground">Manage your shop with AI (MCP)</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            eno.vn runs a hosted <a href="https://modelcontextprotocol.io" className="font-semibold text-accent-foreground hover:underline">Model Context Protocol</a> server,
            so an AI agent (Claude, etc.) can manage your storefront directly — list, create, edit, bulk-import, sync a catalogue,
            read analytics, and manage webhooks. Add it as a remote MCP server with your API key as the Bearer token:
          </p>
          <div className="mt-3"><Code>{`https://eno.vn/api/mcp
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
            Create a key in your <Link href="/dashboard?tab=dev" className="font-semibold text-accent-foreground hover:underline">dashboard → Developers</Link> tab
            (business accounts). The full secret is shown once — store it safely. Send it as a Bearer token on every request:
          </p>
          <div className="mt-3"><Code>{`Authorization: Bearer eno_live_…`}</Code></div>
          <p className="mt-3 text-sm leading-relaxed text-body">
            Keys are scoped: <code className="rounded-lg bg-muted px-1 text-xs font-semibold">listings:read</code>,{' '}
            <code className="rounded-lg bg-muted px-1 text-xs font-semibold">analytics:read</code>,{' '}
            <code className="rounded-lg bg-muted px-1 text-xs font-semibold">listings:write</code>,{' '}
            <code className="rounded-lg bg-muted px-1 text-xs font-semibold">media:write</code> (write is opt-in when you mint
            the key). Every key acts for one shop; requests only ever see that shop&apos;s own data. Revoke a key anytime — it
            takes effect immediately.
          </p>

          <h3 className="mt-6 text-xs font-bold uppercase tracking-wide text-ink-4">OAuth 2.0 (optional) — short-lived tokens</h3>
          <p className="mt-2 text-sm leading-relaxed text-body">
            Prefer not to put the long-lived key on every request? Exchange it for a 1-hour bearer token via the
            client-credentials grant — <code className="rounded-lg bg-muted px-1 text-xs font-semibold">client_id</code> is the
            key&apos;s prefix, <code className="rounded-lg bg-muted px-1 text-xs font-semibold">client_secret</code> is the full key.
            Optionally pass <code className="rounded-lg bg-muted px-1 text-xs">scope</code> to narrow the token (it can never
            exceed the key&apos;s scopes). The returned token works anywhere the key does, including the MCP server.
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

        <h2 className="mt-10 h-section text-foreground">Endpoints</h2>
        <div className="mt-4 space-y-6">
          <Endpoint method="GET" path="/v1/shop" desc="Your storefront profile, trust score, and live listing count.">
            <Code>{`curl ${BASE}/shop \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "shop": { "id", "name", "bio", "location", "phone",
  "avatar_url", "trust_score", "trust_tier",
  "response_rate", "member_since", "active_listings" } }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/v1/listings" desc="Your listings — ALL statuses (active, sold, hidden, held). Keyset-paginated.">
            <Code>{`curl "${BASE}/listings?limit=50" \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "listings": [ { "id", "title", "price", "status",
  "verified", "images", "category", … } ],
  "next_cursor": "eyJ…" | null }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/v1/listings/{id}" desc="A single listing of yours, any status. 404 if it isn't yours.">
            <Code>{`curl ${BASE}/listings/LISTING_ID \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "listing": { "id", "title", "price", "status", … } }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/v1/analytics/summary" desc="Shop rollup: total views + leads and listing counts by status.">
            <Code>{`curl ${BASE}/analytics/summary \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "summary": { "total_listings", "total_views",
  "total_leads", "active", "sold", "hidden", "held" } }`}</Code>
          </Endpoint>

          <h3 className="pt-4 text-xs font-bold uppercase tracking-wide text-ink-4">Write — scopes: listings:write / media:write</h3>

          <Endpoint method="POST" path="/v1/listings" desc="Create a listing. Body: categorySlug, title, price + optional description, images[], district, condition, listingType, brand, model… Send an Idempotency-Key to make retries safe.">
            <Code>{`curl -X POST ${BASE}/listings \\
  -H "Authorization: Bearer eno_live_…" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"categorySlug":"electronics","title":"iPhone 14 Pro",
       "price":18000000,"images":["https://…/api/….webp"]}'`}</Code>
            <Code>{`{ "listing": { "id", "verified" } }`}</Code>
          </Endpoint>

          <Endpoint method="PATCH" path="/v1/listings/{id}" desc="Edit a listing (sparse — only the fields you send change).">
            <Code>{`curl -X PATCH ${BASE}/listings/LISTING_ID \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"price":16500000,"condition":"used"}'`}</Code>
          </Endpoint>

          <Endpoint method="POST" path="/v1/listings/{id}/status" desc="Set availability: active | sold | hidden.">
            <Code>{`curl -X POST ${BASE}/listings/LISTING_ID/status \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"status":"sold"}'`}</Code>
          </Endpoint>

          <Endpoint method="DELETE" path="/v1/listings/{id}" desc="Remove a listing.">
            <Code>{`curl -X DELETE ${BASE}/listings/LISTING_ID \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
          </Endpoint>

          <Endpoint method="POST" path="/v1/media" desc="Upload an image (multipart `file`, or a raw JPEG/PNG/WebP body). Returns a first-party URL to use in images[]. Scope: media:write.">
            <Code>{`curl -X POST ${BASE}/media \\
  -H "Authorization: Bearer eno_live_…" \\
  -F file=@photo.jpg`}</Code>
            <Code>{`{ "url": "https://…supabase.co/…/api/….webp" }`}</Code>
          </Endpoint>

          <Endpoint method="PATCH" path="/v1/shop" desc="Edit your storefront profile (name, bio, location, avatarUrl, phone).">
            <Code>{`curl -X PATCH ${BASE}/shop \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"bio":"Authorized reseller in District 1"}'`}</Code>
          </Endpoint>

          <h3 className="pt-4 text-xs font-bold uppercase tracking-wide text-ink-4">Bulk &amp; catalogue sync — scope: listings:write</h3>

          <Endpoint method="POST" path="/v1/listings/bulk" desc="Create up to 200 listings in one call. Each row is independent (one bad row never aborts the batch); remote image URLs are re-hosted. Send an Idempotency-Key so a retry can't import twice. Returns per-row results.">
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

          <Endpoint method="POST" path="/v1/listings/sync" desc="Upsert your catalogue by your OWN id (externalId, unique per shop) — create new SKUs, update existing ones in place. mode: 'partial' (default) only touches the rows you send; 'full' also RETIRES (hides) any active listing whose externalId is NOT in the payload, so your storefront mirrors your system. Naturally idempotent. Up to 200 rows.">
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

          <Endpoint method="GET" path="/v1/analytics/listings" desc="Daily views + leads (per-day deltas) for each of your listings over a date range, plus current totals. Keyset-paginated by listing. ?from=YYYY-MM-DD&to=YYYY-MM-DD (default last 30 days, max 92).">
            <Code>{`curl "${BASE}/analytics/listings?from=2026-06-01&to=2026-06-29&limit=50" \\
  -H "Authorization: Bearer eno_live_…"`}</Code>
            <Code>{`{ "range": { "from", "to" },
  "listings": [ { "id", "external_id", "title", "status",
    "views_total", "leads_total",
    "daily": [ { "day": "2026-06-28", "views": 12, "leads": 1 }, … ] } ],
  "next_cursor": "eyJ…" | null }`}</Code>
          </Endpoint>

          <h3 className="pt-4 text-xs font-bold uppercase tracking-wide text-ink-4">Webhooks — scope: listings:write (register) / listings:read (list)</h3>

          <Endpoint method="POST" path="/v1/webhooks" desc="Register an HTTPS endpoint to receive SIGNED listing events (listing.created / .updated / .status_changed / .deleted), or pass events:'*' for all. The signing secret is returned ONCE — store it. Up to 10 endpoints per shop. The url must be a public HTTPS address.">
            <Code>{`curl -X POST ${BASE}/webhooks \\
  -H "Authorization: Bearer eno_live_…" -H "Content-Type: application/json" \\
  -d '{"url":"https://your-app/webhooks/eno","events":["listing.created","listing.updated"]}'`}</Code>
            <Code>{`{ "webhook": { "id", "url", "events": ["listing.created","listing.updated"],
  "enabled": true, "created_at", "secret": "whsec_…" } }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/v1/webhooks" desc="List your registered webhook endpoints (secrets are never returned). Shows delivery health: failure_count, last_error, last_delivery_at. An endpoint auto-disables after repeated failures.">
            <Code>{`curl ${BASE}/webhooks -H "Authorization: Bearer eno_live_…"`}</Code>
          </Endpoint>

          <Endpoint method="DELETE" path="/v1/webhooks/{id}" desc="Unregister a webhook endpoint.">
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
          Questions or need write access early? <a href="mailto:support@eno.vn" className="font-semibold text-accent-foreground hover:underline">support@eno.vn</a>.
        </p>
      </main>
      <Footer />
    </div>
  )
}
