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
    <pre className="overflow-x-auto rounded-xl bg-foreground/[0.04] p-3.5 text-[12.5px] leading-relaxed text-foreground ring-1 ring-border">
      <code className="font-mono">{children}</code>
    </pre>
  )
}

function Endpoint({ method, path, desc, children }: { method: string; path: string; desc: string; children?: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-accent px-2 py-0.5 font-mono text-[11px] font-bold text-accent-foreground">{method}</span>
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
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Authentication</h2>
          <p className="mt-2 text-sm leading-relaxed text-body">
            Create a key in your <Link href="/dashboard?tab=dev" className="font-semibold text-accent-foreground hover:underline">dashboard → Developers</Link> tab
            (business accounts). The full secret is shown once — store it safely. Send it as a Bearer token on every request:
          </p>
          <div className="mt-3"><Code>{`Authorization: Bearer eno_live_…`}</Code></div>
          <p className="mt-3 text-sm leading-relaxed text-body">
            Keys are scoped: <code className="rounded bg-muted px-1 text-[12px] font-semibold">listings:read</code>,{' '}
            <code className="rounded bg-muted px-1 text-[12px] font-semibold">analytics:read</code>,{' '}
            <code className="rounded bg-muted px-1 text-[12px] font-semibold">listings:write</code>,{' '}
            <code className="rounded bg-muted px-1 text-[12px] font-semibold">media:write</code> (write is opt-in when you mint
            the key). Every key acts for one shop; requests only ever see that shop&apos;s own data. Revoke a key anytime — it
            takes effect immediately.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="h-section text-foreground">Conventions</h2>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-body">
            <li>• <strong className="text-foreground">Rate limit:</strong> 600 requests/min per key. Responses carry <code className="rounded bg-muted px-1 text-[12px]">X-RateLimit-Limit</code> / <code className="rounded bg-muted px-1 text-[12px]">X-RateLimit-Remaining</code> and an <code className="rounded bg-muted px-1 text-[12px]">X-Request-Id</code>.</li>
            <li>• <strong className="text-foreground">Pagination:</strong> list endpoints are keyset-paged — pass <code className="rounded bg-muted px-1 text-[12px]">?limit=</code> (≤100) and <code className="rounded bg-muted px-1 text-[12px]">?cursor=</code>; follow <code className="rounded bg-muted px-1 text-[12px]">next_cursor</code> until it&apos;s <code className="rounded bg-muted px-1 text-[12px]">null</code>.</li>
            <li>• <strong className="text-foreground">Errors:</strong> <code className="rounded bg-muted px-1 text-[12px]">{`{ "error": { "code", "message" } }`}</code> — e.g. <code className="rounded bg-muted px-1 text-[12px]">401 unauthorized</code>, <code className="rounded bg-muted px-1 text-[12px]">403 insufficient_scope</code>, <code className="rounded bg-muted px-1 text-[12px]">404 not_found</code>, <code className="rounded bg-muted px-1 text-[12px]">422 invalid_input</code>, <code className="rounded bg-muted px-1 text-[12px]">429 rate_limited</code>.</li>
            <li>• <strong className="text-foreground">Idempotency:</strong> on a create, send <code className="rounded bg-muted px-1 text-[12px]">Idempotency-Key: &lt;unique-id&gt;</code> — a retry replays the first result instead of creating twice.</li>
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
        </div>

        <p className="mt-10 border-t border-border pt-6 text-sm text-body">
          Questions or need write access early? <a href="mailto:support@eno.forum" className="font-semibold text-accent-foreground hover:underline">support@eno.forum</a>.
        </p>
      </main>
      <Footer />
    </div>
  )
}
