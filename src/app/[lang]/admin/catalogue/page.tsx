import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell, pickTab } from '@/components/admin/section-shell'
import { AdminListingsClient } from '@/components/admin/admin-listings-client'
import { AdminBrandsClient } from '@/components/admin/admin-brands-client'
import { LicenceChecks, licenceGrandfatherUntilLabel } from '@/components/admin/licence-checks'
import { TeacherPhotoChecks } from '@/components/admin/teacher-photo-checks'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Catalogue — eno.vn admin', robots: { index: false, follow: false } }

// Console v2: what is on sale (listings) and the brand taxonomy behind search are tabs of ONE Catalogue section. Both
// are the existing client consoles; their APIs re-check getAdmin().
// Licence checks (owner, 2026-10-14) is the third: e-Visa and Legal & permits listings from anyone but eno's desk go
// live only once an admin approves the provider's licence there. Server-rendered (licence-checks.tsx) — it reads the
// rows itself, behind the getAdmin() above, and its two actions POST to api/admin/listings, which re-checks it.
// Teacher photos (owner, 2026-10-16) is the fourth: what the automatic profile-photo check refused or asked about, and
// the "Photo is fine" override against a wrong refusal.
const TABS = ['listings', 'licences', 'teacher-photos', 'brands'] as const

export default async function AdminCataloguePage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const tab = pickTab((await searchParams)?.tab, TABS, 'listings')
  return (
    <AdminSectionShell
      title="Catalogue"
      description={<>Signed in as {admin}. Listings to approve, hide or feature; the licence checks e-Visa and Legal &amp; permits listings wait for; the brand catalogue that powers search.</>}
      basePath="/admin/catalogue"
      tabs={[{ key: 'listings', label: 'Listings' }, { key: 'licences', label: 'Licence checks' }, { key: 'teacher-photos', label: 'Teacher photos' }, { key: 'brands', label: 'Brands' }]}
      active={tab}
    >
      {/* The listings console is a client component and cannot import licence-stamp.ts (node:crypto), so the
          grandfather's end date for its "No licence · until …" badge is handed down from here. */}
      {tab === 'listings' ? <AdminListingsClient licenceGrandfatherUntil={licenceGrandfatherUntilLabel()} /> : tab === 'licences' ? <LicenceChecks /> : tab === 'teacher-photos' ? <TeacherPhotoChecks /> : <AdminBrandsClient />}
    </AdminSectionShell>
  )
}
