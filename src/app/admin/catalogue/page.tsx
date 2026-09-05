import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell, pickTab } from '@/components/admin/section-shell'
import { AdminListingsClient } from '@/components/admin/admin-listings-client'
import { AdminBrandsClient } from '@/components/admin/admin-brands-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Catalogue — eno.vn admin', robots: { index: false, follow: false } }

// Console v2: what is on sale (listings) and the brand taxonomy behind search are two tabs of ONE
// Catalogue section. Both tabs are the existing client consoles; their APIs re-check getAdmin().
const TABS = ['listings', 'brands'] as const

export default async function AdminCataloguePage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const tab = pickTab((await searchParams)?.tab, TABS, 'listings')
  return (
    <AdminSectionShell
      title="Catalogue"
      description={<>Signed in as {admin}. Listings to approve, hide or feature; the brand catalogue that powers search.</>}
      basePath="/admin/catalogue"
      tabs={[{ key: 'listings', label: 'Listings' }, { key: 'brands', label: 'Brands' }]}
      active={tab}
    >
      {tab === 'listings' ? <AdminListingsClient /> : <AdminBrandsClient />}
    </AdminSectionShell>
  )
}
