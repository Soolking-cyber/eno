'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  Mail,
  MessageCircle,
  Plane,
  Rocket,
  Search,
  SearchX,
  ShoppingBag,
  Stamp,
  Star,
  Tag,
  UserRoundCog,
  UsersRound,
  ShieldCheck,
} from '@/components/ui/icons'
import type { IconComponent } from '@/components/ui/icons'
import { Tr, useLanguage, useTr } from '@/context/language-context'
import { STROKE_UI } from '@/lib/icon-tokens'
// ⚠️ FROM category-glyph, NOT category-icons — importing the renderer from the registry file
// drags its 99-icon map into this route's chunk (see category-glyph.tsx's header).
import { CategoryGlyphArt } from '@/components/marketplace/category-glyph'
import { HelpFeedback } from '@/components/marketplace/help-feedback'
import { HelpVote } from '@/components/marketplace/help-vote'
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from '@/components/ui/accordion'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { HELP_TOPICS, splitIntoColumns } from '@/lib/help-center'
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

// Topic glyphs, keyed by SLUG (the kebab-case `icon` strings in lib/help-center.ts are
// mirrored into DB ForumCommunity.icon — they stay untouched; only artwork maps here).
// 'help-trust-safety' is absent on purpose: first-party trust renders the eno seal, not
// a lucide shield (icon-language §0b), via <HelpTopicIcon> below. 'eno-service-help'
// (services edition only) gets a deliberate entry so it never falls back to UsersRound.
const TOPIC_ICONS: Record<string, IconComponent> = {
  'help-getting-started': Rocket,
  'help-buying': ShoppingBag,
  'help-selling': Tag,
  'help-account': UserRoundCog,
  'vietnam-travel': Plane,
  'eno-service-help': Stamp,
}

/**
 * The one renderer for a help topic's glyph — shared by the /help chips, the grouped
 * answer headings and the thread page's topic chip, so the family cannot drift.
 * Trust renders the eno seal (§0b: the seal replaces lucide Shield* wherever
 * first-party trust is claimed); unknown slugs fall back to UsersRound (community).
 *
 * ⛔ THE PER-SLUG `TOPIC_WASH` MAP IS GONE (owner, 2026-08-07: "use icons filling only
 * when selected, not as default"). It hand-picked one closed region per glyph — rocket
 * body = path 2, tag body = path 1, account head = a <circle>, buying = nothing at all
 * because lucide draws the bag body LAST — so the chip row rendered three different
 * densities side by side, and the one topic with no safe region never filled however you
 * selected it. `<CategoryGlyphArt selected>` draws the glyph twice instead (tinted body
 * under the untouched ink line), which is order-independent, needs no curation, and gives
 * every topic the same density. The idle chip is unchanged: pure line.
 *
 * `selected` is the ONLY thing that fills.
 *
 * ⚠️ TRUST & SAFETY IS THE ONE TOPIC WITH NO SELECTED STATE, AND THAT IS A KNOWN COST OF THE SEAL
 * SWEEP, not an oversight. It used to render <EnoSeal variant={selected ? 'wash' : 'line'}> — the
 * seal's own washed chief was how this row said "active" for that chip. The seal was replaced
 * app-wide with Solar (owner, 2026-08-13: "use solar"), and Solar's bold weight is driven by the
 * `.i-on` layer, which globals.css switches on an ANCESTOR's aria-selected/aria-current — not on a
 * React prop. So this branch takes `className` and ignores `selected`. Every other topic still
 * fills. Flagged to the owner rather than papered over: the fix is either to give the chip a real
 * aria-selected (which would light the glyph for free, and is the better answer) or to accept one
 * topic that marks selection by chip background alone.
 */
export function HelpTopicIcon({ slug, className, selected = false }: { slug: string; className?: string; selected?: boolean }) {
  if (slug === 'help-trust-safety') return <ShieldCheck className={className} />
  const Icon = TOPIC_ICONS[slug] ?? UsersRound
  // STROKE_UI, not the duotone's display default: these mount at 14–16px, where the 1.5
  // display tier scales to under a pixel and goes wispy beside its lucide neighbours (§2).
  return <CategoryGlyphArt Icon={Icon} selected={selected} stroke={STROKE_UI} className={className} />
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
          {/* First-party verification renders the ONE mark (icon-language §0b: the seal
              replaces lucide badges/shields wherever eno itself vouches) — inline tier,
              wash, on the accent ink the old check used. */}
          {review.sellerVerified && <ShieldCheck className="size-4 shrink-0 text-accent-foreground" />}
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
              {/* Micro-tier seal echo (§0b ladder: trust chips on cards carry the mark
                  at 10–12px) — same construction as the PDP reviews-preview pill, so
                  "verified buyer" is one glyph everywhere it is claimed. */}
              <ShieldCheck className="size-3" />
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
  useEffect(() => {
    setHydrated(true)
    // Deep-linkable search (?q=…): read AFTER hydration so the server-rendered HTML and
    // the first client render agree (this is state, not URL routing — the page itself
    // never navigates on keystroke). Also what lets the zero-result state be reached by
    // URL instead of only by typing.
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setQuery(q)
  }, [])

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
  // 3-question "Getting started" next to 6-question "Buying & offers" the gap was most
  // of a screen. CSS `columns-2` fixes the packing but can slice an accordion across the
  // column break as panels open. Packing the groups ourselves gives independent columns
  // with neither problem.
  //
  // The algorithm and every measured number behind it live in `splitIntoColumns` (and
  // are covered by help-center-columns.test.ts, whose cases are mutation-verified — put
  // the old greedy pack back and six of them fail). The short version: ONE contiguous
  // split, never an alternating greedy pack — the columns stack below `lg`, so
  // interleaving them scrambles the curated topic order on every phone.
  const columns = useMemo(() => splitIntoColumns(groups), [groups])

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
                active
                  ? // §5 location-active: accent ink on the chip; the glyph's own fill is
                    // passed as state below, never as a class here — never a solid fill,
                    // which is reserved for user-state.
                    'border-brand bg-accent text-accent-foreground'
                  : 'bg-transparent text-body hover:bg-muted',
              )}
            >
              {/* `active` is the same boolean that paints the chip and sets aria-pressed —
                  one selection fact, three renderings of it. */}
              <HelpTopicIcon slug={item.slug} selected={active} className="size-4" />
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
          /* ⚠️ BARE /* *\/ HERE, NOT {/* *\/} — a JSX comment container is only valid as a
             CHILD, and this is a ternary branch. The braces form parses as an object
             literal and takes the whole file down (TS1005 at the next section).

             `lg:grid-cols-2` only when BOTH columns have something in them. With one
             populated column an unconditional two-column grid renders that topic at half
             width beside a void, the narrower measure making it look like a rendering
             failure rather than a result. Empty columns are dropped rather than rendered
             as empty divs, so the grid has nothing to reserve space for.

             ⚠️ ON REACHABILITY, because a reviewer and I both got this wrong in opposite
             directions. The reviewer said a search matching one topic hits it; that is
             FALSE — `grouped` is `!topic && !needle`, so any search or topic filter drops
             to the flat list below and this grid is not rendered at all. Verified in the
             browser: searching "eSIM", "etiquette" or "notifications" produces no grouped
             grid. What CAN reach it is a thin taxonomy — the edition filter or a sparse
             DB leaving fewer than two topics that have posts. Rarer than claimed, still
             real, and one className either way. */
          <div className={cn('mt-2 grid items-start gap-x-12', columns.every((c) => c.length > 0) && 'lg:grid-cols-2')}>
            {columns.filter((column) => column.length > 0).map((column, index) => (
              <div key={index}>
                {column.map((group) => (
                  <section key={group.topic.slug} className="mt-6">
                    {/* The Shelf-header discipline: a 16px line-only glyph on the heading's
                        ink. A heading is not a selection, so no `selected` — including on
                        the trust topic, whose seal drops to its `line` variant here rather
                        than carrying a chief nothing else on the row has. */}
                    <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                      <HelpTopicIcon slug={group.topic.slug} className="size-4" />
                      {tr(group.topic.name, group.topic.nameVi)}
                    </h3>
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
        {/* ⚠️ The rows below are `gap-1`, NOT `justify-between` — the chevron has to belong
            to the WORD. These rows are 596px wide in the 2-column grid while the labels are
            only 76–114px, so justify-between threw the glyph 466–505px away from the text it
            points at (measured at 1440px). At that distance it stops reading as "this label
            goes somewhere" and becomes a column of loose arrows down the right edge. Sitting
            it against the label keeps the whole row tappable — the Link is still the flex
            container, so its full width and the border-b underline are unchanged — and lets
            the hover slide actually mean something, because the eye is already on the glyph. */}
        <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {MORE_LINKS.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              className="group flex items-center gap-1 border-b border-border/60 py-3 text-sm font-semibold text-foreground transition-colors hover:text-accent-foreground"
            >
              <Tr text={label} />
              {/* ⚠️ `motion-reduce:group-hover:translate-x-0` is NOT redundant beside
                  `motion-reduce:transition-none`. Killing the transition only removes the
                  TWEEN — the 2px displacement still happens, instantly, which is precisely
                  the jump a reduced-motion reader asked not to see. Both are needed to make
                  the slide actually not exist; the colour change carries the hover on its
                  own. pdp-shop-link.tsx's chevron, where this idiom came from, was missing
                  the same pair and is fixed in this commit.
                  `translate-x` is physical, not logical, so it would slide the wrong way
                  under dir=rtl. Harmless today — the UI ships EN and VI only, and nothing
                  in src/ sets dir=rtl — but if an RTL locale is ever added this is one of
                  three call sites (here, pdp-shop-link, listing-card) to sweep together. */}
              {/* ⚠️ `transition-[color,translate]`, NOT `[color,transform]`. Tailwind v4's
                  translate-x-* utilities set the `translate` PROPERTY, not `transform`, so an
                  arbitrary transition list naming `transform` animates nothing and the chevron
                  jumps its 2px instead of sliding. Measured: with `transform` the position had
                  ONE distinct value across six samples through the 200ms window; with
                  `translate` it tweens. The bare `transition-transform` utility is safe here
                  (v4 expands it to transform+translate+scale+rotate) — it is only the
                  hand-written arbitrary list that has to name the real property. */}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-[color,translate] duration-200 group-hover:translate-x-0.5 group-hover:text-accent-foreground motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
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
