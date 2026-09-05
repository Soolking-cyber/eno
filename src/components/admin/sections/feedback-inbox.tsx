import { db } from '@/lib/db'
import { FeedbackClient, type FeedbackItem } from '@/components/admin/feedback-client'

// Product feedback + technical-problem reports sent from the Help sheet and Help Center.
// A tab of /admin/insights since console v2.
export async function FeedbackInbox() {
  // Resilient if the Feedback table isn't migrated yet (pre-push deploy).
  const rows = await db.feedback
    .findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 300 })
    .catch(() => [] as Awaited<ReturnType<typeof db.feedback.findMany>>)
  const items: FeedbackItem[] = rows.map((r) => ({
    id: r.id, kind: r.kind, message: r.message, email: r.email, url: r.url, status: r.status, createdAt: r.createdAt.toISOString(),
  }))
  return (
    <section aria-labelledby="feedback-inbox">
      <h2 id="feedback-inbox" className="sr-only">Feedback</h2>
      <p className="mb-4 text-sm text-muted-foreground">Product feedback and technical-problem reports sent from the Help sheet and Help Center.</p>
      <FeedbackClient items={items} />
    </section>
  )
}
