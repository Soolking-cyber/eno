import type { Metadata } from 'next'
import { db } from '@/lib/db'
import type { SerializedCategory } from '@/lib/types'
import { DashboardClient } from './dashboard-client'

export const metadata: Metadata = {
  title: 'Dashboard | eno.vn',
  robots: { index: false, follow: false },
}

export default async function DashboardPage() {
  // Categories power the inline "Post a listing" tab (no redirect).
  const categories = await db.category.findMany({ orderBy: { name: 'asc' } })
  const serialized: SerializedCategory[] = categories.map((c) => ({
    id: c.id, name: c.name, nameVi: c.nameVi, slug: c.slug, icon: c.icon,
    color: c.color as SerializedCategory['color'], description: c.description, verifiedCount: 0,
  }))
  return <DashboardClient categories={serialized} />
}
