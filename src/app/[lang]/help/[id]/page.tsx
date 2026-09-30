import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { organizationId, withShare } from '@/lib/site-identity'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { loadHelpThread, loadRelatedHelp } from '@/lib/help-center-data'
import { cachedTranslations } from '@/lib/translate'
import { LANG_COOKIE } from '@/lib/lang-variant'
import { embedLanguages, pickEmbedded, readerLanguage } from './embed-languages'
import { HelpThreadClient, type HelpComment } from './help-thread-client'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; lang: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, lang } = await params
  const thread = await loadHelpThread(id)
  if (!thread) return { title: `Help center | ${SITE_NAME}` }
  // The Vietnamese variant's <title> is the curated translation when the cache holds one
  // (L-CONTENT-VI) — one indexed read, the same one the page makes below.
  const viTitle = lang === 'vi' ? (await cachedTranslations([thread.post.title]))[thread.post.title]?.vi : undefined
  // Both share cards are built by withShare() from the thread's OWN title, on either variant: a share
  // scraper sends no language, so the card must not depend on which variant it happened to hit.
  const meta = withShare({
    title: `${thread.post.title} | ${SITE_NAME}`,
    // The body is plain text, so a slice is a safe description — no markup to strip.
    description: thread.post.body.replace(/\s+/g, ' ').slice(0, 200),
    alternates: { canonical: `/help/${id}` },
  }, { type: 'article' })
  return viTitle ? { ...meta, title: `${viTitle} | ${SITE_NAME}` } : meta
}

export default async function HelpThreadPage({ params }: Params) {
  const { id } = await params
  const thread = await loadHelpThread(id)
  // loadHelpThread only resolves published posts inside a HELP topic, so a general
  // forum thread id 404s here rather than rendering inside Help Center chrome.
  if (!thread) notFound()

  // Related answers (C-HELP-CENTER) and every translation the page renders, in one cache read: the
  // curated Vietnamese of each seeded answer lives in the Translation cache, and embedding it here is
  // what puts a Vietnamese h1 and body in the server HTML instead of after hydration (L-CONTENT-VI).
  // A failed read degrades to the client path it replaced (cachedTranslations swallows its own errors).
  // ⚠️ ONLY THE READER'S LANGUAGES ARE EMBEDDED (embed-languages.ts): the cache holds every language
  // anyone has read the thread in, and the client reads at most en, vi and its own.
  const [relatedRows, jar, head] = await Promise.all([
    loadRelatedHelp(thread.post.community, thread.post.id).catch(() => []),
    cookies(),
    headers(),
  ])
  const keep = embedLanguages(readerLanguage(jar.get(LANG_COOKIE)?.value, head.get('accept-language')))
  const translations = await cachedTranslations([thread.post.title, thread.post.body, ...relatedRows.map((r) => r.title)])
  const related = relatedRows.map((r) => ({ id: r.id, title: r.title, i18n: pickEmbedded(translations[r.title], keep) }))

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

  /**
   * ⛔ Article, NOT QAPage OR FAQPage — CHOSEN AGAINST THE DATA, NOT AGAINST THE URL SHAPE. These read
   * like questions, so QAPage is the obvious guess and it would be a lie: QAPage describes a question
   * with ANSWERS, and this corpus has none — measured on production, 44 published help posts and 0
   * published comments. The answer IS the post body, written by us. FAQPage is the other tempting
   * miss: it describes a LIST of question/answer pairs on one page, not a page that is one answer, and
   * Google has restricted its rich result to a handful of authoritative sites anyway.
   * Article is what this actually is — an editorial answer with a title, a body, a date and a
   * publisher — and it is the type that stays true the day someone does reply.
   * `dateModified` is `thread.modifiedAt` — the answer's `editedAt ?? createdAt`, never the row's
   * `updatedAt`, which a vote or a view also moves (help-center-data.ts) — and the sitemap submits the
   * same value as this URL's lastmod, so the two agree rather than telling Google different stories.
   */
  /**
   * ⚠️ THE EDITION'S OWN ORIGIN, AND THE FALLBACK IS THE POINT OF THE COMMENT. Both editions serve
   * /help, so a bare `|| 'https://eno.vn'` would, on a services build with the env unset, publish
   * structured data naming the LICENSED MARKETPLACE as the author and publisher of the services site's
   * help — attributing one operator's content to another (opus). SITE_NAME is inlined per edition, so
   * it is the honest thing to fall back on.
   */
  const origin = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
  // Marketplace only: the author/publisher IS the layout's Organization node, by @id (site-identity.ts).
  // eno.forum's layout declares no @id — the two editions must not read as one entity.
  const orgRef = IS_SERVICES ? {} : { '@id': organizationId(origin) }
  const helpJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': thread.post.title,
    'articleBody': thread.post.body,
    'datePublished': thread.post.createdAt,
    'dateModified': thread.modifiedAt,
    'inLanguage': 'en',
    'mainEntityOfPage': { '@type': 'WebPage', '@id': `${origin}/help/${id}` },
    'author': { '@type': 'Organization', ...orgRef, 'name': SITE_NAME, 'url': origin },
    'publisher': { '@type': 'Organization', ...orgRef, 'name': SITE_NAME, 'url': origin },
  }

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      {/* JSON.stringify of a locally built object — no user HTML reaches this sink. */}
      {/**
        * ⛔ `<` IS ESCAPED, AND JSON.stringify DOES NOT DO IT FOR YOU. Help threads are DB rows — a body
        * containing `</script><img src=x onerror=…>` closes this element and the rest executes as markup.
        * JSON escaping is not HTML escaping; the site's other JSON-LD blocks use the same `\u003c` trick
        * (seo-article.tsx's `ldJson`). Found by review before it shipped, on a sink that reads user text.
        */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(helpJsonLd).replace(/</g, '\\u003c') }} />
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-16">
        {/* key = the thread id. HelpThreadClient seeds useState from these props, and a
            client-side hop between two /help/[id] routes reuses the same component
            instance — without a key the previous thread's replies and half-typed draft
            would render under the new question. The key forces a fresh mount. */}
        <HelpThreadClient
          key={thread.post.id}
          post={thread.post}
          comments={comments}
          i18n={{ title: pickEmbedded(translations[thread.post.title], keep), body: pickEmbedded(translations[thread.post.body], keep) }}
          related={related}
        />
      </main>
      <Footer />
    </div>
  )
}
