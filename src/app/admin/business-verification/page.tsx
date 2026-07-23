import type { Metadata } from 'next'
import Link from 'next/link'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { listPendingVerifications } from '@/lib/core/business-verification-service'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Business verification — eno.vn admin', robots: { index: false, follow: false } }

// Business-verification operator queue (EN-only, admin chrome). Channel 2 of the
// verified-business badge is this human review: confirm the uploaded identity document
// and that a bank document's holder name matches the registered legal name. Channel 1
// (tax registry) is checked automatically and re-checked at approval.

export default async function AdminBusinessVerificationPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />

  const cases = await listPendingVerifications()

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
      </main>
    </div>
  )
}
