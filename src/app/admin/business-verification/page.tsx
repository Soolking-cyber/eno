import type { Metadata } from 'next'
import Link from 'next/link'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { HISTORY_LIMIT, listDecidedVerifications, listPendingVerifications } from '@/lib/core/business-verification-service'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Business verification — eno.vn admin', robots: { index: false, follow: false } }

// Business-verification operator queue (EN-only, admin chrome). Channel 2 of the
// verified-business badge is this human review: confirm the uploaded identity document
// and that a bank document's holder name matches the registered legal name. Channel 1
// (tax registry) is checked automatically and re-checked at approval.

export default async function AdminBusinessVerificationPage({
  searchParams,
}: {
  // ⚠️ `string | string[]`, because that is what the URL can actually produce.
  searchParams?: Promise<{ q?: string | string[] }>
}) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />

  /**
   * ⛔ NORMALISE BEFORE USE — `?q=a&q=b` HANDS YOU AN ARRAY, and `.slice()` on an array returns an
   * ARRAY, so the value sailed through into `listDecidedVerifications`, where `q.trim()` threw and
   * took the whole admin page down with a 500. Reviewer-caught. Typing the param as `string` did
   * not prevent it: the annotation was simply wrong about what Next hands over, and a wrong type
   * is worse than none because it stops you looking.
   */
  const raw = (await searchParams)?.q
  const q = (Array.isArray(raw) ? raw[0] ?? '' : raw ?? '').slice(0, 100)
  // Both lists in one round trip — the history is never the reason the page is slow.
  const [cases, decided] = await Promise.all([listPendingVerifications(), listDecidedVerifications(q)])

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <div className="mb-5">
          <h1 className="h-title text-foreground">Business verification</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Signed in as {admin}. Confirm the uploaded business/identity document AND that the bank
            document&apos;s account-holder name matches the registered legal name before approving. The
            tax-registry check (Channel 1) is verified automatically and re-checked on approval.
          </p>
        </div>

        {!cases.length ? (
          <Card className="px-5 py-6">
            <p className="text-sm text-muted-foreground">No pending business-verification cases.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {cases.map((c) => (
              <Link key={c.id} href={`/admin/business-verification/${c.id}`} className="block">
                <Card className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                  <Badge variant="warning">Pending</Badge>
                  <span className="font-semibold text-foreground">{c.seller?.name ?? '—'}</span>
                  {c.seller?.legalName && <span className="text-sm text-muted-foreground">{c.seller.legalName}</span>}
                  {c.seller?.taxCode && <span className="font-mono text-xs text-ink-4">MST {c.seller.taxCode}</span>}
                  <span className="ml-auto text-xs text-ink-4">
                    {c.submittedAt ? new Date(c.submittedAt).toLocaleString() : ''}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* ── History ───────────────────────────────────────────────────────────────────────
            Owner, 2026-08-17: "have verified businesses history with search in business
            verification page". The queue above is work TO DO; this is what was already decided.

            ⚠️ A PLAIN <form method="get">, NOT A CLIENT SEARCH BOX. The filtering happens in the
            query (see listDecidedVerifications), so it covers every decided case rather than the
            50 that happen to be rendered — a client-side filter over a `take`-limited list looks
            identical right up to the moment the company you are looking for is on page 2, and then
            says "no results" about a business you verified yourself. It also means the URL carries
            the search, so an operator can share or bookmark one. */}
        <div className="mt-10">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">History</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Decided cases, newest first. Search by storefront name, registered legal name or tax code.
              </p>
              {/* ⚠️ THE CAP IS STATED, NOT HIDDEN. The search runs in the QUERY so it considers every
                  decided case, but the RESULT is capped — an operator who does not know that could
                  read a truncated list as a complete one. Narrowing the search is the way to reach
                  older rows until this needs real pagination. */}
              {decided.length >= HISTORY_LIMIT && (
                <p className="mt-0.5 text-xs text-warning">
                  Showing the {HISTORY_LIMIT} most recent matches — narrow the search to see older cases.
                </p>
              )}
            </div>
            <form method="get" className="flex items-center gap-2">
              <Input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Name, legal name or MST…"
                aria-label="Search decided verification cases"
                className="w-64"
              />
              <Button type="submit" variant="outline">Search</Button>
              {q && (
                <Link href="/admin/business-verification" className="text-sm text-muted-foreground underline">
                  Clear
                </Link>
              )}
            </form>
          </div>

          {!decided.length ? (
            <Card className="px-5 py-6">
              <p className="text-sm text-muted-foreground">
                {q ? `No decided cases match “${q}”.` : 'No decided cases yet.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {decided.map((c) => (
                <Link key={c.id} href={`/admin/business-verification/${c.id}`} className="block">
                  <Card className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                    <Badge variant={c.status === 'approved' ? 'success' : 'destructive'}>
                      {c.status === 'approved' ? 'Approved' : 'Rejected'}
                    </Badge>
                    <span className="font-semibold text-foreground">{c.seller?.name ?? '—'}</span>
                    {c.seller?.legalName && <span className="text-sm text-muted-foreground">{c.seller.legalName}</span>}
                    {c.seller?.taxCode && <span className="font-mono text-xs text-ink-4">MST {c.seller.taxCode}</span>}
                    {/* The rejection note is why an operator opens this list at all — "what did we
                        ask them to change?" — so it is on the row, not one click away. */}
                    {c.status === 'rejected' && c.note && (
                      <span className="w-full text-xs text-warning sm:w-auto">“{c.note}”</span>
                    )}
                    <span className="ml-auto text-right text-xs text-ink-4">
                      {c.reviewedAt ? new Date(c.reviewedAt).toLocaleString() : ''}
                      {c.reviewedBy && <span className="block text-ink-4">by {c.reviewedBy}</span>}
                    </span>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
