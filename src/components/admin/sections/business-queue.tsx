import Link from 'next/link'
import { HISTORY_LIMIT, listDecidedVerifications, listPendingVerifications } from '@/lib/core/business-verification-service'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Business-verification operator queue (EN-only, admin chrome). Channel 2 of the verified-business
// badge is this human review: confirm the uploaded identity document and that a bank document's
// holder name matches the registered legal name. Channel 1 (tax registry) is checked automatically
// and re-checked at approval. A tab of /admin/verification since console v2.
export async function BusinessQueue({ q }: { q: string }) {
  // Both lists in one round trip — the history is never the reason the page is slow.
  const [cases, decided] = await Promise.all([listPendingVerifications(), listDecidedVerifications(q)])
  return (
    <section aria-labelledby="business-queue">
      <h2 id="business-queue" className="sr-only">Business verification queue</h2>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Confirm the uploaded business/identity document AND that the bank document&apos;s account-holder
        name matches the registered legal name before approving. The tax-registry check (Channel 1) is
        verified automatically and re-checked on approval.
      </p>

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
                <span className="ml-auto text-xs text-ink-4">{c.submittedAt ? new Date(c.submittedAt).toLocaleString() : ''}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* ── History ── the queue above is work TO DO; this is what was already decided.
          ⚠️ A PLAIN <form method="get">, NOT A CLIENT SEARCH BOX: the filtering happens in the query
          (listDecidedVerifications), so it covers every decided case rather than the 50 rendered, and
          the URL carries the search. The form keeps the tab in its action so a search stays here. */}
      <div className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-foreground">History</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Decided cases, newest first. Search by storefront name, registered legal name or tax code.
            </p>
            {decided.length >= HISTORY_LIMIT && (
              <p className="mt-0.5 text-xs text-warning">
                Showing the {HISTORY_LIMIT} most recent matches — narrow the search to see older cases.
              </p>
            )}
          </div>
          <form method="get" action="/admin/verification" className="flex items-center gap-2">
            {/* GET forms drop the action's query string, so the tab rides along as a field. */}
            <Input type="hidden" name="tab" value="business" readOnly />
            <Input type="search" name="q" defaultValue={q} placeholder="Name, legal name or MST…" aria-label="Search decided verification cases" className="w-64" />
            <Button type="submit" variant="outline">Search</Button>
            {q && (
              <Link href="/admin/verification?tab=business" className="text-sm text-muted-foreground underline">Clear</Link>
            )}
          </form>
        </div>

        {!decided.length ? (
          <Card className="px-5 py-6">
            <p className="text-sm text-muted-foreground">{q ? `No decided cases match “${q}”.` : 'No decided cases yet.'}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {decided.map((c) => (
              <Link key={c.id} href={`/admin/business-verification/${c.id}`} className="block">
                <Card className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                  <Badge variant={c.status === 'approved' ? 'success' : 'destructive'}>{c.status === 'approved' ? 'Approved' : 'Rejected'}</Badge>
                  <span className="font-semibold text-foreground">{c.seller?.name ?? '—'}</span>
                  {c.seller?.legalName && <span className="text-sm text-muted-foreground">{c.seller.legalName}</span>}
                  {c.seller?.taxCode && <span className="font-mono text-xs text-ink-4">MST {c.seller.taxCode}</span>}
                  {c.status === 'rejected' && c.note && <span className="w-full text-xs text-warning sm:w-auto">“{c.note}”</span>}
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
    </section>
  )
}
