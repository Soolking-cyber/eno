import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getCurrentProfile } from '@/lib/admin'
import { Spinner } from '@/components/ui/spinner'
import { ForumClient, type ForumActivity } from './forum-client'
import { loadForumActivity } from './load-activity'

export const metadata: Metadata = {
  title: 'Forum activity | eno.vn',
  robots: { index: false, follow: false },
}

// Per-user data read from the request cookie — this page must never be served
// from a prerendered shell.
export const dynamic = 'force-dynamic'

// Queries live in ./load-activity (shared with the /dashboard home's Forum card);
// this page resolves the profile and renders exactly as before.
async function loadActivity(): Promise<ForumActivity | null> {
  const profile = await getCurrentProfile()
  if (!profile) return null
  return loadForumActivity(profile.id)
}

async function ForumActivityBody() {
  return <ForumClient activity={await loadActivity()} />
}

export default function ForumActivityPage() {
  return (
    <Suspense
      fallback={
        <div role="status" className="flex min-h-[50vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <ForumActivityBody />
    </Suspense>
  )
}
