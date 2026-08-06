import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { loadHelpThread } from '@/lib/help-center-data'
import { HelpThreadClient, type HelpComment } from './help-thread-client'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const thread = await loadHelpThread(id)
  if (!thread) return { title: `Help center | ${SITE_NAME}` }
  return {
    title: `${thread.post.title} | ${SITE_NAME}`,
    // The body is plain text, so a slice is a safe description — no markup to strip.
    description: thread.post.body.replace(/\s+/g, ' ').slice(0, 200),
    alternates: { canonical: `/help/${id}` },
  }
}

export default async function HelpThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const thread = await loadHelpThread(id)
  // loadHelpThread only resolves published posts inside a HELP topic, so a general
  // forum thread id 404s here rather than rendering inside Help Center chrome.
  if (!thread) notFound()

  const flat: HelpComment[] = thread.comments.map((comment) => ({
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    body: comment.body,
    author: {
      id: comment.author?.id ?? null,
      name: comment.author?.displayName || comment.authorName || 'eno member',
      avatarUrl: comment.author?.avatarUrl ?? null,
      avatarColor: comment.author?.avatarColor ?? null,
    },
    helpful: comment.helpful,
    score: comment.score,
    viewerVote: comment.votes[0]?.value ?? 0,
    createdAt: comment.createdAt.toISOString(),
    replies: [],
  }))

  // Nest one level. ForumComment is a tree and eno.forum lets people reply to a reply,
  // so rendering the rows flat would detach every such reply from what it answers —
  // "Thanks, that worked" would read as a new top-level comment. Deeper descendants are
  // hoisted to their nearest rendered ancestor rather than dropped.
  const byId = new Map(flat.map((comment) => [comment.id, comment]))
  const comments: HelpComment[] = []
  for (const comment of flat) {
    if (!comment.parentId) {
      comments.push(comment)
      continue
    }
    let parent = byId.get(comment.parentId)
    // Walk up to the top-level ancestor so a 3rd-level reply still lands somewhere.
    while (parent?.parentId) parent = byId.get(parent.parentId)
    if (parent) parent.replies.push(comment)
    // An orphan (parent hidden/removed by moderation) is shown at top level rather
    // than silently disappearing along with its parent.
    else comments.push(comment)
  }

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-16">
        {/* key = the thread id. HelpThreadClient seeds useState from these props, and a
            client-side hop between two /help/[id] routes reuses the same component
            instance — without a key the previous thread's replies and half-typed draft
            would render under the new question. The key forces a fresh mount. */}
        <HelpThreadClient key={thread.post.id} post={thread.post} comments={comments} />
      </main>
      <Footer />
    </div>
  )
}
