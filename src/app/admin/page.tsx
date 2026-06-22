import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { Header } from '@/components/marketplace/header'
import { ModerationClient, type ModItem, type AccountReport } from '@/components/admin/moderation-client'
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

type Row = {
  id: string
  title: string
  titleVi: string | null
  price: number
  currency: string
  priceUnit: string
  location: string
  images: string
  createdAt: Date
  category: { name: string }
  seller: { name: string; phone: string | null }
  reports: { id: string; reason: string; detail: string | null; createdAt: Date }[]
}

function toItem(r: Row): ModItem {
  return {
    id: r.id,
    title: r.title,
    price: r.price,
    currency: r.currency,
    priceUnit: r.priceUnit,
    location: r.location,
    category: r.category.name,
    sellerName: r.seller.name,
    sellerPhone: r.seller.phone,
    image: firstImage(r.images),
    createdAt: r.createdAt.toISOString(),
    reports: r.reports.map((rep) => ({
      id: rep.id,
      reason: rep.reason,
      detail: rep.detail,
      createdAt: rep.createdAt.toISOString(),
    })),
  }
}

export default async function AdminPage() {
  const admin = await getAdmin()

  if (!admin) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex flex-1 items-center justify-center px-3">
          <div className="max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-pop">
            <ShieldAlert className="mx-auto h-10 w-10 text-ink-4" />
            <h1 className="mt-4 text-lg font-bold text-foreground">Restricted area</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with an authorized eno.vn admin account to access the moderation queue.
            </p>
            <a href="/" className="mt-5 inline-block rounded-xl bg-[#0a66c2] px-6 py-2 text-sm font-bold text-white hover:bg-[#004182] transition-colors">
              Back to eno.vn
            </a>
          </div>
        </main>
      </div>
    )
  }

  const include = {
    category: { select: { name: true } },
    seller: { select: { name: true, phone: true } },
  }

  const [pendingRows, reportedRows, accountReportRows] = await Promise.all([
    db.listing.findMany({
      where: { verified: false },
      include: { ...include, reports: { where: { status: 'open' }, orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.listing.findMany({
      where: { verified: true, reports: { some: { status: 'open' } } },
      include: { ...include, reports: { where: { status: 'open' }, orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    // Storefront/account reports have no listing — fetch them directly so they're
    // actionable (scalar target columns have no Prisma relation, so resolve names below).
    db.report.findMany({
      where: { status: 'open', listingId: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ])

  const pending = pendingRows.map((r) => toItem(r as unknown as Row))
  const reported = reportedRows.map((r) => toItem(r as unknown as Row))

  const sellerIds = [...new Set(accountReportRows.map((r) => r.targetSellerId).filter((x): x is string => !!x))]
  const sellers = sellerIds.length
    ? await db.seller.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } })
    : []
  const nameById = new Map(sellers.map((s) => [s.id, s.name]))
  const accountReports: AccountReport[] = accountReportRows.map((r) => ({
    id: r.id,
    reason: r.reason,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
    targetSellerId: r.targetSellerId,
    targetName: r.targetSellerId ? nameById.get(r.targetSellerId) ?? null : null,
  }))

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="h-title text-foreground">Moderation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {admin}. Resolve reports (confirm docks trust); held listings need a photo or are from restricted accounts.</p>
        </div>
        <ModerationClient pending={pending} reported={reported} accountReports={accountReports} />
      </main>
    </div>
  )
}
