import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { AdminNav } from '@/components/admin/admin-nav'
import { FeedbackClient, type FeedbackItem } from '@/components/admin/feedback-client'
import { ShieldAlert } from 'lucide-react'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Feedback — eno.vn',
  robots: { index: false, follow: false },
}

export default async function AdminFeedbackPage() {
  const admin = await getAdmin()

  if (!admin) {
    return (
      <div className="flex flex-1 flex-col">
        <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-3">
          <div className="max-w-sm rounded-2xl bg-card p-8 text-center shadow-pop">
            <ShieldAlert className="mx-auto h-10 w-10 text-ink-4" />
            <h1 className="mt-4 text-lg font-bold text-foreground">Restricted area</h1>
            <p className="mt-2 text-sm text-muted-foreground">Sign in with an authorized eno.vn admin account.</p>
            <a href="/" className="mt-5 inline-block rounded-xl bg-primary px-6 py-2 text-sm font-bold text-white hover:bg-brand-dark transition-colors">Back to eno.vn</a>
          </div>
        </main>
      </div>
    )
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
