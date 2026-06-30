import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import type { SerializedCategory } from '@/lib/types'
import { DashboardClient } from './dashboard-client'

// Localize the browser-tab title to the visitor's language (the page is already dynamic).
export async function generateMetadata(): Promise<Metadata> {
  const lang = (await cookies()).get('lang')?.value
  return { title: `${lang === 'vi' ? 'Bảng điều khiển' : 'Dashboard'} | eno.vn`, robots: { index: false, follow: false } }
}

// Authed + personalized, and the client reads ?tab via useSearchParams → dynamic.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  // Categories power the inline "Post a listing" tab (no redirect).
  const categories = await db.category.findMany({ orderBy: { name: 'asc' } })
  const serialized: SerializedCategory[] = categories.map((c) => ({
    id: c.id, name: c.name, nameVi: c.nameVi, slug: c.slug, icon: c.icon,
    color: c.color as SerializedCategory['color'], description: c.description, verifiedCount: 0,
  }))
  return <DashboardClient categories={serialized} />
}
