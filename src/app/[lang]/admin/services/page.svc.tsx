import type { Metadata } from 'next'
import { getTripDeskScope, getVisaDeskScope } from '@/lib/desk-operator'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell, pickTab } from '@/components/admin/section-shell'
import { VisaQueue } from './visa-queue'
import { TripsQueue } from './trips-queue'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Service desks — eno.vn admin', robots: { index: false, follow: false } }

// Console v2: the two desk queues (visas, trips) are tabs of ONE Services section. Services edition
// only (`.svc.`); the marketplace build has no such page and the old /admin/visas, /admin/trips
// redirect here. Each tab keeps its OWN desk-scope gate — the two desks are authorised separately.
const TABS = ['visas', 'trips'] as const

export default async function AdminServicesPage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  const [visa, trips] = await Promise.all([getVisaDeskScope(), getTripDeskScope()])
  if (!visa && !trips) return <AdminDenied />
  const tabs = [
    ...(visa ? [{ key: 'visas', label: 'Visas' }] : []),
    ...(trips ? [{ key: 'trips', label: 'Trips' }] : []),
  ]
  const allowed = tabs.map((t) => t.key) as unknown as readonly (typeof TABS)[number][]
  const tab = pickTab((await searchParams)?.tab, allowed, allowed[0])
  return (
    <AdminSectionShell
      title="Service desks"
      description={<>Signed in as {(visa ?? trips)!.operator}. The e-Visa desk and the trip desk, one case at a time.</>}
      basePath="/admin/services"
      tabs={tabs}
      active={tab}
    >
      {tab === 'visas' && visa && <VisaQueue scope={visa} />}
      {tab === 'trips' && trips && <TripsQueue scope={trips} />}
    </AdminSectionShell>
  )
}
