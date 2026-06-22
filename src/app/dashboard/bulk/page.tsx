import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { BulkUploadClient } from './bulk-client'

export const metadata: Metadata = {
  title: 'Bulk upload | eno.vn',
  robots: { index: false, follow: false },
}

export default async function BulkUploadPage() {
  const cats = await db.category.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true } })
  return <BulkUploadClient categories={cats} />
}
