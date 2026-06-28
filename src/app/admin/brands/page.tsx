import { getAdmin } from '@/lib/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { ShieldAlert } from 'lucide-react'
import type { Metadata } from 'next'
import { AdminBrandsClient } from '@/components/admin/admin-brands-client'
import { AdminNav } from '@/components/admin/admin-nav'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Brand curation — eno.vn', robots: { index: false, follow: false } }

export default async function AdminBrandsPage() {
  const admin = await getAdmin()
  if (!admin) {
    return (
      <div className="flex min-h-screen flex-col">
        <AdminHeader />
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-semibold text-body">Admins only.</p>
        </main>
      </div>
    )
  }
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <AdminHeader />
      <main id="main" tabIndex={-1} className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-8 pb-16">
        <AdminNav active="/admin/brands" />
        <AdminBrandsClient />
      </main>
    </div>
  )
}
