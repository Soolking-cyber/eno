import { AdminDenied } from '@/components/admin/admin-denied'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { AdminNav } from '@/components/admin/admin-nav'
import { FeedbackClient, type FeedbackItem } from '@/components/admin/feedback-client'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Feedback — eno.vn',
  robots: { index: false, follow: false },
}

export default async function AdminFeedbackPage() {
  const admin = await getAdmin()

  if (!admin) {
    return <AdminDenied />
  }

  // Resilient if the Feedback table isn't migrated yet (pre-push deploy).
  const rows = await db.feedback
    .findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 300 })
    .catch(() => [] as Awaited<ReturnType<typeof db.feedback.findMany>>)

  const items: FeedbackItem[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    email: r.email,
    url: r.url,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }))

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <AdminNav active="/admin/feedback" />
        <div className="mb-6">
          <h1 className="h-title text-foreground">Feedback</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {admin}. Product feedback + technical-problem reports sent from the Help sheet and Help Center.</p>
        </div>
        <FeedbackClient items={items} />
      </main>
    </div>
  )
}
