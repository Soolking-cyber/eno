import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { BulkUploadClient } from './bulk-client'

// Localize the browser-tab title to the visitor's language.
export async function generateMetadata(): Promise<Metadata> {
  const lang = (await cookies()).get('lang')?.value
  return { title: `${lang === 'vi' ? 'Tải lên hàng loạt' : 'Bulk upload'} | eno.vn`, robots: { index: false, follow: false } }
}

export default async function BulkUploadPage() {
  const cats = await db.category.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true } })
  return <BulkUploadClient categories={cats} />
}
