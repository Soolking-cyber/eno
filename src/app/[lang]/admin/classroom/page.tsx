import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell } from '@/components/admin/section-shell'
import { ClassroomAdminClient } from '@/components/admin/classroom-admin-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Classroom — eno.vn admin', robots: { index: false, follow: false } }

// eno Classroom operations (plan "Files › /admin/classroom"): the switch and the minute caps, this month's use and cost
// against Spatius's own console, the likeness queue (made by hand in Spatius Studio; deletions to do there), reports that
// failed, and sessions with a safety flag. The client reads and writes /api/admin/classroom.
export default async function AdminClassroomPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  return (
    <AdminSectionShell title="Classroom" description="eno Classroom — the pilot switch, budgets and queues.">
      <ClassroomAdminClient />
    </AdminSectionShell>
  )
}
