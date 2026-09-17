import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { db } from '@/lib/db'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell, pickTab } from '@/components/admin/section-shell'
import { IdentityQueue } from '@/components/admin/sections/identity-queue'
import { BusinessQueue } from '@/components/admin/sections/business-queue'

/**
 * ⛔ NEVER STATICALLY RENDERED AND NEVER CACHED. The identity rows carry 10-minute signed URLs to
 * passport and CCCD photographs, minted per request. A cached render is an expired link at best
 * and, at worst, one viewer's document URLs served to the next — `force-dynamic` here is a privacy
 * control, not a freshness preference.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const metadata: Metadata = { title: 'Verification — eno.vn admin', robots: { index: false, follow: false } }

// Console v2: identity (the person) and business (the storefront) verification are two tabs of ONE
// section. The tab with pending work opens first, so the queue that needs a human is never hidden
// behind a default — the way /admin/identity was hidden behind a missing nav row for a week.
const TABS = ['identity', 'business'] as const

export default async function AdminVerificationPage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[]; q?: string | string[] }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const sp = await searchParams
  const [pendingIdentity, pendingBusiness] = await Promise.all([
    db.identityVerification.count({ where: { status: 'pending' } }),
    db.sellerVerification.count({ where: { status: 'pending' } }),
  ])
  const tab = pickTab(sp?.tab, TABS, pendingIdentity === 0 && pendingBusiness > 0 ? 'business' : 'identity')
  const rawQ = sp?.q
  const q = (Array.isArray(rawQ) ? rawQ[0] ?? '' : rawQ ?? '').slice(0, 100)
  return (
    <AdminSectionShell
      title="Verification"
      description={<>Signed in as {admin}. Stage 1 verifies the person (identity); stage 2 verifies their business. A person verifies before they have a storefront.</>}
      basePath="/admin/verification"
      tabs={[
        { key: 'identity', label: 'Identity', count: pendingIdentity },
        { key: 'business', label: 'Business', count: pendingBusiness },
      ]}
      active={tab}
    >
      {tab === 'identity' ? <IdentityQueue /> : <BusinessQueue q={q} />}
    </AdminSectionShell>
  )
}
