import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { AdminNav } from '@/components/admin/admin-nav'
import { ModerationClient, type ModItem, type AccountReport, type ModReport } from '@/components/admin/moderation-client'
import { reportContext } from '@/lib/admin-reports'
import { ShieldAlert } from 'lucide-react'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Moderation — eno.vn',
  robots: { index: false, follow: false },
}

function firstImage(images: string): string | null {
  try {
    const arr = JSON.parse(images || '[]')
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
  } catch {
    return null
  }
}

// One open report as the DB returns it (the fields we surface in the queue).
type DbReport = {
  id: string
  reason: string
  detail: string | null
  severity: string | null
  createdAt: Date
  reporterProfileId: string | null
  listingId: string | null
  conversationId: string | null
  targetSellerId: string | null
  targetProfileId: string | null
}

type Row = {
  id: string
  title: string
  price: number
  currency: string
  priceUnit: string
  location: string
  images: string
  createdAt: Date
  category: { name: string }
  seller: { name: string; phone: string | null; ownerId: string | null }
  reports: DbReport[]
}

export default async function AdminPage() {
  const admin = await getAdmin()

  if (!admin) {
    return (
      <div className="flex min-h-screen flex-col">
        <AdminHeader />
        <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-3">
          <div className="max-w-sm rounded-2xl bg-card p-8 text-center shadow-pop">
            <ShieldAlert className="mx-auto h-10 w-10 text-ink-4" />
            <h1 className="mt-4 text-lg font-bold text-foreground">Restricted area</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with an authorized eno.vn admin account to access the moderation queue.
            </p>
            <a href="/" className="mt-5 inline-block rounded-xl bg-primary px-6 py-2 text-sm font-bold text-white hover:bg-brand-dark transition-colors">
              Back to eno.vn
            </a>
          </div>
        </main>
      </div>
    )
  }

  const include = {
    category: { select: { name: true } },
    seller: { select: { name: true, phone: true, ownerId: true } },
    reports: { where: { status: 'open' as const }, orderBy: { createdAt: 'desc' as const } },
  }

  const [pendingRows, reportedRows, accountReportRows] = await Promise.all([
    db.listing.findMany({
      where: { verified: false },
      include,
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.listing.findMany({
      where: { verified: true, reports: { some: { status: 'open' } } },
      include,
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    // Storefront/account + chat reports have no listing — fetch them directly.
    db.report.findMany({
      where: { status: 'open', listingId: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ])

  // Resolve the reporter identity + the conversation to link for EVERY open report, in
  // one batched pass (the report relation has no Prisma relation to Profile/Conversation).
  const allReports: DbReport[] = [
    ...pendingRows.flatMap((l) => l.reports as unknown as DbReport[]),
    ...reportedRows.flatMap((l) => l.reports as unknown as DbReport[]),
    ...(accountReportRows as unknown as DbReport[]),
  ]
  const { reporterById, convoByReportId } = await reportContext(allReports)

  const mapReport = (r: DbReport): ModReport => ({
    id: r.id,
    reason: r.reason,
    detail: r.detail,
    severity: r.severity,
    createdAt: r.createdAt.toISOString(),
    reporter: r.reporterProfileId ? reporterById.get(r.reporterProfileId) ?? null : null,
    conversationId: convoByReportId.get(r.id) ?? null,
  })

  const toItem = (r: Row): ModItem => ({
    id: r.id,
    title: r.title,
    price: r.price,
    currency: r.currency,
    priceUnit: r.priceUnit,
    location: r.location,
    category: r.category.name,
    sellerName: r.seller.name,
    sellerPhone: r.seller.phone,
    sellerProfileId: r.seller.ownerId,
    image: firstImage(r.images),
    createdAt: r.createdAt.toISOString(),
    reports: r.reports.map(mapReport),
  })

  const pending = (pendingRows as unknown as Row[]).map(toItem)
  const reported = (reportedRows as unknown as Row[]).map(toItem)

  const sellerIds = [...new Set((accountReportRows as unknown as DbReport[]).map((r) => r.targetSellerId).filter((x): x is string => !!x))]
  const sellers = sellerIds.length
    ? await db.seller.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } })
    : []
  const nameById = new Map(sellers.map((s) => [s.id, s.name]))
  const accountReports: AccountReport[] = (accountReportRows as unknown as DbReport[]).map((r) => ({
    ...mapReport(r),
    targetSellerId: r.targetSellerId,
    targetProfileId: r.targetProfileId,
    targetName: r.targetSellerId ? nameById.get(r.targetSellerId) ?? null : null,
  }))

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AdminHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-3 py-8 sm:px-6">
        <AdminNav active="/admin" />
        <div className="mb-6">
          <h1 className="h-title text-foreground">Moderation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {admin}. Resolve reports (confirm docks trust); held listings need a photo or are from restricted accounts.</p>
        </div>
        <ModerationClient pending={pending} reported={reported} accountReports={accountReports} />
      </main>
    </div>
  )
}
