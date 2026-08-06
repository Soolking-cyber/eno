'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  BadgeCheck,
  ChevronRight,
  Mail,
  MessageCircle,
  Plane,
  Rocket,
  Search,
  SearchX,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  UserRoundCog,
  UsersRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tr, useLanguage, useTr } from '@/context/language-context'
import { HelpFeedback } from '@/components/marketplace/help-feedback'
import { HelpVote } from '@/components/marketplace/help-vote'
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from '@/components/ui/accordion'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { HELP_TOPICS } from '@/lib/help-center'
import { FORUM_URL, goToForum } from '@/lib/forum-nav'
import type { HelpCenterData, HelpPost, HelpReview } from '@/lib/help-center-data'
import { cn } from '@/lib/utils'

// The Help Center body — shared by the public /help page AND the dashboard "Help" tab.
//
// It is DB-backed (owner 2026-07-21: "turn the forum into help center"). Every answer is
// a real ForumPost in one of the help topics, so it can be upvoted, commented on and
// moderated by the machinery eno.forum already has, and the same rows render on
// www.eno.forum as the public web face. The old hard-coded SECTIONS array is gone: its 22
// Q&A pairs were rewritten, fact-checked against the code and seeded as posts by
// scripts/sync-help-center.ts. That fixed several answers that were simply WRONG
// (we are live in all 34 provinces, not "HCMC with Hanoi and Da Nang coming soon";
// saving a listing needs no account; blocked posts are rejected with a fixable error
// rather than "held for review").
//
// i18n: chrome uses LITERAL tr()/<Tr text="…"> so scripts/gen-ui-strings.mjs can harvest
// it — the previous version rendered its FAQ through <Tr text={variable}>, which the
// harvester cannot see, so every question paid a lazy per-string translation round trip.
// Post titles/bodies are user content and go through useTr(), whose Vietnamese is
// pre-seeded into the Translation cache by the sync script.

const TOPIC_ICONS: Record<string, LucideIcon> = {
  'help-getting-started': Rocket,
  'help-buying': ShoppingBag,
  'help-selling': Tag,
  'help-trust-safety': ShieldCheck,
  'help-account': UserRoundCog,
  'vietnam-travel': Plane,
}

const MORE_LINKS: { label: string; href: string }[] = [
  { label: 'How eno.vn works', href: '/guide' },
  { label: 'How trust works', href: '/trust' },
  { label: 'Safe trading', href: '/safety' },
  { label: 'About eno.vn', href: '/about' },
  { label: 'Post a listing', href: '/post' },
  { label: 'Saved listings', href: '/saved' },
  { label: 'Browse by brand', href: '/brands' },
  { label: 'Contact us', href: '/about#contact' },
  { label: 'Terms of use', href: '/terms' },
  { label: 'Privacy policy', href: '/privacy' },
]

function matches(post: HelpPost, needle: string): boolean {
  if (!needle) return true
  return `${post.title} ${post.body} ${post.flair}`.toLocaleLowerCase().includes(needle)
}

/** One FAQ answer. The question is the accordion trigger; the answer body, the upvote and
 *  the discussion link live in the panel. */
function AnswerItem({ post }: { post: HelpPost }) {
  const { tr } = useLanguage()
  const title = useTr(post.title)
  const body = useTr(post.body)

  return (
    <AccordionItem value={post.id}>
      <AccordionTrigger>{title}</AccordionTrigger>
      <AccordionPanel>
        {/* Bodies are plain text with "•" bullets — nothing in the stack renders
            markdown, so whitespace-pre-line is what preserves the authored shape. */}
        <p className="whitespace-pre-line">{body}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <HelpVote id={post.id} kind="post" score={post.score} viewerVote={post.viewerVote} size="sm" />
          <span className="text-xs text-muted-foreground">
            {tr('Was this helpful?', 'Câu trả lời này có hữu ích không?')}
          </span>
          <Link
            href={`/help/${encodeURIComponent(post.id)}`}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent-foreground hover:underline"
          >
            {post.commentCount > 0
              ? tr(`Discussion (${post.commentCount})`, `Thảo luận (${post.commentCount})`)
              : tr('Ask a follow-up', 'Hỏi thêm')}
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </AccordionPanel>
    </AccordionItem>
  )
}

/** A community question asked inside a help topic — the Reddit half of the page. */
function QuestionCard({ post }: { post: HelpPost }) {
  const { tr } = useLanguage()
  const title = useTr(post.title)

  return (
    <li>
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <HelpVote id={post.id} kind="post" score={post.score} viewerVote={post.viewerVote} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <Link href={`/help/${encodeURIComponent(post.id)}`} className="block">
            <p className="line-clamp-2 text-sm font-semibold text-foreground hover:text-accent-foreground">{title}</p>
          </Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="truncate">{post.author.name}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3.5" aria-hidden />
              {post.commentCount}
              <span className="sr-only">{tr('replies', 'phản hồi')}</span>
            </span>
          </p>
        </div>
      </div>
    </li>
  )
}

/** Business reviews are READ-ONLY here (owner decision): the card links to the seller's
 *  storefront, which stays the canonical, moderated home of the review. */
function ReviewCard({ review }: { review: HelpReview }) {
  const { tr } = useLanguage()
  const text = useTr(review.text)

  return (
    <li>
      <Link
        href={`/sellers/${encodeURIComponent(review.sellerId)}`}
        className="press flex h-full flex-col rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted"
      >
        <div className="flex items-center gap-2">
          <Avatar name={review.sellerName} url={review.sellerAvatarUrl} color={review.sellerAvatarColor} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{review.sellerName}</span>
          {review.sellerVerified && <BadgeCheck className="size-4 shrink-0 text-accent-foreground" aria-hidden />}
        </div>
        {/* --rating is a deliberate token, held apart from --warning so a caution
            colour change never repaints review stars (globals.css). */}
        <div className="mt-2 flex items-center gap-1" aria-label={tr(`${review.rating} out of 5`, `${review.rating} trên 5`)}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              aria-hidden
              className={cn('size-3.5', star <= review.rating ? 'fill-rating text-rating' : 'text-muted-foreground')}
            />
          ))}
        </div>
        <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-body">{text}</p>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{review.author}</span>
          {review.verifiedBuyer && (
            <Badge variant="brand" size="sm">
              <Tr text="Verified buyer" />
            </Badge>
          )}
        </p>
      </Link>
    </li>
  )
}

export function HelpCenter({ data }: { data: HelpCenterData }) {
  const { tr } = useLanguage()
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  // Explicit hydration signal (same idiom as the forum's data-hydrated). The page is
  // fully server-rendered, so search and the topic chips LOOK ready before React has
  // attached: a keystroke or tap before then is swallowed and no amount of assertion
  // retrying recovers it, because the event is simply gone. Tests wait on this instead
  // of sleeping, and it costs one attribute.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  const needle = query.trim().toLocaleLowerCase()

  const answers = useMemo(
    () => data.answers.filter((post) => (!topic || post.community === topic) && matches(post, needle)),
    [data.answers, topic, needle],
  )
  const questions = useMemo(
    () => data.questions.filter((post) => (!topic || post.community === topic) && matches(post, needle)),
    [data.questions, topic, needle],
  )

  // Grouped by topic when browsing everything; a flat list once the reader has
  // narrowed by topic or typed a query (grouping one bucket is just noise).
  const grouped = !topic && !needle
  const groups = useMemo(
    () =>
      HELP_TOPICS.map((item) => ({
        topic: item,
        posts: answers.filter((post) => post.community === item.slug),
      })).filter((group) => group.posts.length > 0),
    [answers],
  )

  // Two BALANCED columns, packed here rather than by the grid.
  //
  // A plain `lg:grid-cols-2` lays the groups out row by row, so each row grows to its
  // tallest cell and a short topic leaves a visible hole beside a long one — with
  // 3-question "Getting started" next to 6-question "Buying & offers" the gap was
  // most of a screen. CSS `columns-2` fixes the packing but can slice an accordion
  // across the column break as panels open. Distributing greedily by question count
  // gives independent columns with neither problem.
  const columns = useMemo(() => {
    const left: typeof groups = []
    const right: typeof groups = []
    let leftCount = 0
    let rightCount = 0
    for (const group of groups) {
      // +1 per group for its heading, so a topic's fixed chrome is weighed too.
      const weight = group.posts.length + 1
      if (leftCount <= rightCount) {
        left.push(group)
        leftCount += weight
      } else {
        right.push(group)
        rightCount += weight
      }
    }
    return [left, right]
  }, [groups])

  const resetFilters = () => {
    setQuery('')
    setTopic(null)
  }

  return (
    <div data-help-center data-hydrated={hydrated ? 'true' : 'false'} className="w-full">
      <h1 className="h-display max-w-4xl text-balance text-foreground"><Tr text="How can we help?" /></h1>
      <p className="mt-4 max-w-[70ch] text-base leading-relaxed text-body">
        <Tr text="Answers about buying, selling, trust and staying safe on eno.vn — plus practical guides for getting around Vietnam. Upvote what helped you, and ask anything that is missing." />
      </p>

      {/* Search — the page's primary affordance. The wrapper owns the box, so it also
          owns the focus ring (the Input inside is `unstyled` by contract — ui/input). */}
      <div className="mt-6 flex items-center rounded-xl bg-tint px-3 transition-shadow focus-within:ring-2 focus-within:ring-ring/30">
        <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          variant="unstyled"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr('Search help', 'Tìm trong trợ giúp')}
          aria-label={tr('Search the help center', 'Tìm trong trung tâm trợ giúp')}
          className="min-w-0 flex-1 px-3 py-3 text-base"
        />
      </div>

      {/* Topics */}
      <div className="no-scrollbar -mx-3 mt-4 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Button
          type="button"
          variant="bare"
          size="none"
          aria-pressed={topic === null}
          onClick={() => setTopic(null)}
          className={cn(
            'h-10 shrink-0 rounded-full border border-border px-4 text-xs font-semibold transition-colors',
            topic === null ? 'border-brand bg-accent text-accent-foreground' : 'bg-transparent text-body hover:bg-muted',
          )}
        >
          <Tr text="All topics" />
        </Button>
        {HELP_TOPICS.map((item) => {
          const Icon = TOPIC_ICONS[item.slug] ?? UsersRound
          const active = topic === item.slug
          return (
            <Button
              key={item.slug}
              type="button"
              variant="bare"
              size="none"
              aria-pressed={active}
              onClick={() => setTopic(active ? null : item.slug)}
              className={cn(
                'h-10 shrink-0 gap-2 rounded-full border border-border px-4 text-xs font-semibold transition-colors',
                active ? 'border-brand bg-accent text-accent-foreground' : 'bg-transparent text-body hover:bg-muted',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {tr(item.name, item.nameVi)}
            </Button>
          )
        })}
      </div>

      {/* Answers — the hairline below the search/topic block is the family's article
          hero rule (title + lede + hairline), applied to the one page with a toolbar. */}
      <section className="mt-8 border-t border-border pt-8" aria-labelledby="help-answers-title">
        <h2 id="help-answers-title" className="h-section text-foreground">
          <Tr text="Answers" />
        </h2>
        {answers.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={tr('No answers match your search.', 'Không có câu trả lời phù hợp.')}
            subtitle={tr('Try another wording or topic — or ask the community below.', 'Thử từ khóa hoặc chủ đề khác — hoặc hỏi cộng đồng bên dưới.')}
            action={
              <Button type="button" variant="outline" onClick={resetFilters}>
                <Tr text="Reset search" />
              </Button>
            }
            className="mt-3 bg-transparent ring-0"
          />
        ) : grouped ? (
          <div className="mt-2 grid items-start gap-x-12 lg:grid-cols-2">
            {columns.map((column, index) => (
              <div key={index}>
                {column.map((group) => (
                  <section key={group.topic.slug} className="mt-6">
                    <h3 className="text-base font-bold text-foreground">{tr(group.topic.name, group.topic.nameVi)}</h3>
                    <Accordion className="mt-1">
                      {group.posts.map((post) => (
                        <AnswerItem key={post.id} post={post} />
                      ))}
                    </Accordion>
                  </section>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Accordion className="mt-3">
            {answers.map((post) => (
              <AnswerItem key={post.id} post={post} />
            ))}
          </Accordion>
        )}
      </section>

      {/* Community questions */}
      <section className="mt-12 border-t border-border pt-8" aria-labelledby="help-community-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="help-community-title" className="h-section text-foreground">
            <Tr text="From the community" />
          </h2>
          {/* A real cross-origin URL for a11y / middle-click, with a left-click
              intercepted so the native app takes the SSO handoff instead of landing
              signed out. Posting stays on eno.forum on purpose — it owns the
              composer, the media bucket and its storage RLS. */}
          <Button variant="outline" size="sm" asChild>
            <a
              href={`${FORUM_URL}/`}
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                goToForum('/')
              }}
            >
              <Tr text="Ask the community" />
            </a>
          </Button>
        </div>
        {questions.length === 0 ? (
          <p className="mt-3 text-sm text-body">
            <Tr text="No community questions here yet — be the first to ask." />
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {questions.map((post) => (
              <QuestionCard key={post.id} post={post} />
            ))}
          </ul>
        )}
      </section>

      {/* Business reviews */}
      {data.reviews.length > 0 && (
        <section className="mt-12 border-t border-border pt-8" aria-labelledby="help-reviews-title">
          <h2 id="help-reviews-title" className="h-section text-foreground">
            <Tr text="Recent business reviews" />
          </h2>
          <p className="mt-1.5 text-sm text-body">
            <Tr text="Left by buyers after a completed deal. Open a seller to read every review on their storefront." />
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </ul>
        </section>
      )}

      {/* More from eno.vn */}
      <section className="mt-12 border-t border-border pt-8">
        <h2 className="h-section text-foreground"><Tr text="More from eno.vn" /></h2>
        <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {MORE_LINKS.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              className="group flex items-center justify-between border-b border-border/60 py-3 text-sm font-semibold text-foreground transition-colors hover:text-accent-foreground"
            >
              <Tr text={label} />
              <ChevronRight className="size-4 text-muted-foreground transition-colors group-hover:text-accent-foreground" />
            </Link>
          ))}
        </div>
      </section>

      {/* Send feedback / report a problem */}
      <section className="mt-12 border-t border-border pt-8">
        <h2 className="h-section text-foreground"><Tr text="Send us a message" /></h2>
        <p className="mt-1.5 mb-4 text-sm text-body">
          <Tr text="Share feedback or report a technical problem — it goes straight to our team." />
        </p>
        <HelpFeedback />
      </section>

      {/* Escalation. Kept as the LAST thing on the page on purpose: a reader who got
          here did not find their answer above, and this is the human path out. */}
      <div className="mt-12 flex flex-col items-start gap-3 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-foreground"><Tr text="Still need help?" /></p>
          <p className="text-sm text-body"><Tr text="Our team replies within one business day." /></p>
        </div>
        <Button asChild variant="cta" size="none">
          <a href="mailto:support@eno.vn" className="shrink-0 px-5 py-2.5">
            <Mail className="size-4" /> support@eno.vn
          </a>
        </Button>
      </div>
    </div>
  )
}
