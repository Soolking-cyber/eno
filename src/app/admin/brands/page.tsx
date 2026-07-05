import { AdminDenied } from '@/components/admin/admin-denied'
import { getAdmin } from '@/lib/admin'
import type { Metadata } from 'next'
import { AdminBrandsClient } from '@/components/admin/admin-brands-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Brand curation — eno.vn', robots: { index: false, follow: false } }

export default async function AdminBrandsPage() {
  const admin = await getAdmin()
  if (!admin) {
    return <AdminDenied />
  }
  return (
    <div className="flex flex-1 flex-col blob-bg">
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-8 pb-16">
        <AdminBrandsClient />
      </main>
    </div>
  )
}
