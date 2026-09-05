import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell } from '@/components/admin/section-shell'
import { UsersClient } from '@/components/admin/users-client'
import { ADMIN_USER_FILTERS, type AdminUserFilter } from '@/lib/admin-users'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Users — eno.vn admin', robots: { index: false, follow: false } }

// The Users section (console v2, 2026-09-05): find any account, open it, act on it. The list is a
// client console over GET /api/admin/users; the detail page is server-rendered.
export default async function AdminUsersPage({ searchParams }: { searchParams?: Promise<{ q?: string | string[]; filter?: string | string[] }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const sp = await searchParams
  const q = Array.isArray(sp?.q) ? sp?.q[0] ?? '' : sp?.q ?? ''
  const rawFilter = Array.isArray(sp?.filter) ? sp?.filter[0] : sp?.filter
  const filter = (ADMIN_USER_FILTERS as readonly string[]).includes(rawFilter ?? '') ? (rawFilter as AdminUserFilter) : 'all'
  return (
    <AdminSectionShell title="Users" description={<>Signed in as {admin}. Every account — identity, storefront, reports, enforcement, and the erasure an admin may carry out on a written request.</>}>
      <UsersClient initialFilter={filter} initialQuery={q} />
    </AdminSectionShell>
  )
}
