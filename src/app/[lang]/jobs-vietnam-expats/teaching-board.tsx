import { Fragment } from 'react'
import Link from 'next/link'
import { db } from '@/lib/db'
import { SITE_NAME } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { seoLandingWhere } from '@/components/marketplace/seo-landing-where'
import { vnToday } from '@/lib/job-listing'
import { Row, Rows } from '@/components/ui/rows'
import { ChevronRight } from '@/components/ui/icons'
import { LANDING_TARGET } from './landing-target'
import { boardJobs, boardSections, boardSummary, emptySectionLine, jobMeta, jobMetaParts, sectionHeading, summaryLead, summaryRest, type BoardJob } from './board'

/**
 * THE ENGLISH TEACHING JOBS BOARD on /jobs-vietnam-expats (teacher visibility plan B2, 2026-10-18): every live teaching
 * job as a server-rendered link, by city, under a summary counted from the same lines. What it says is decided in
 * board.ts — every word included, so this file carries no copy of its own (plain English, like SeoLanding's props);
 * this file reads the rows and draws them.
 *
 * ⛔ THE PAGE'S OWN NARROWING, SCOPED LIKE EVERY LISTING READ: `seoLandingWhere(LANDING_TARGET)` is the predicate the
 * page's `robots` and its sitemap entry count with (verified, active, Jobs › Teaching, job posts), wrapped in
 * `scopedListingWhere` — the edition scope and the teacher-profile exclusion every listing query carries. Never a
 * hand-written where: one that forgot `verified` or the scope would list hidden rows on a public page.
 * ⚠️ So `robots` and the board can disagree in one direction only: a row the board leaves out (board.ts header — a closed
 * linked job, or one the licensing screen refuses) still counts for `robots`. The board can only come out EMPTY while
 * rows are live if no open, clean linked job is left at all — the daily import stopped long enough for every apply-by
 * date to pass (14 days at most) — and the only other rows are direct posts the screen refuses. Then the page stays
 * indexable over SeoLanding's "just getting started" state instead of answering noindex. Accepted rather than giving
 * `robots` a second count: the sitemap gates on this same predicate (pages.xml/build.ts), so the two never disagree
 * the other way — a submitted URL that answers noindex — and the state means the job supply itself has stopped,
 * which the import's own log shows first.
 */

/**
 * A bound on one page's HTML, far above the live count (38 teaching jobs on 2026-10-18). Reaching it would cut the
 * oldest rows off the board and out of the summary alike, so the two still agree.
 */
const BOARD_MAX = 400

/** The rows the board shows, and `day`: the Vietnamese calendar day (YYYY-MM-DD) they were read — the summary's date. */
export type TeachingBoard = { known: boolean; jobs: BoardJob[]; day: string }

/**
 * The board's rows. `known` is false only when the read failed while `next build` prerendered (no database reachable
 * then) — which the page must not show as "no jobs" (SeoLanding's `inventory` note); ISR (`revalidate = 3600`) fills it
 * in at the first regeneration.
 * ⛔ AT RUNTIME A FAILED READ THROWS, ON PURPOSE (review, 2026-10-18). This read runs inside an ISR regeneration: one
 * that throws keeps serving the last good render, while one that swallowed the error would cache a page whose main
 * content — the list — is gone, for at least the revalidate window, and `robots` (which swallows its own failure into
 * "indexable") would keep that page in the index. category-data.ts lets its reads throw for the same reason. At build
 * there is no earlier render to keep, so there — and only there — the failure becomes "could not look".
 */
export async function loadTeachingBoard(now: number = Date.now()): Promise<TeachingBoard> {
  const day = vnToday(now)
  try {
    const rows = await db.listing.findMany({
      where: await scopedListingWhere(seoLandingWhere(LANDING_TARGET)),
      orderBy: [{ postedAt: 'desc' }, { id: 'asc' }],
      take: BOARD_MAX,
      select: {
        id: true, title: true, city: true, attributes: true, price: true, priceUnit: true, currency: true, affiliateUrl: true,
        seller: { select: { name: true } },
      },
    })
    return { known: true, jobs: boardJobs(rows, now), day }
  } catch (e) {
    // The variable src/lib/db.ts reads too. `next build` sets it in its own environment just before it starts the
    // prerender workers, which inherit it (next/dist/build/index.js); it is not inlined into the bundle (define-env.js
    // inlines NEXT_RUNTIME, not this), so the running server never has it.
    if (process.env.NEXT_PHASE !== 'phase-production-build') throw e
    return { known: false, jobs: [], day }
  }
}

/**
 * The summary, then one section per city: a heading the summary links to, and a ruled row per job — the "Keep reading"
 * rows' shape on the same page (ui/rows, flat-surface canon §3b), title over its line, chevrons on one right edge.
 * Nothing when there is nothing to list (or nothing could be read): SeoLanding then draws its own state.
 * ⚠️ `prefetch={false}`: forty-odd job links in view would each prefetch a listing page nobody may open; the pages are
 * cached, so a tap is fast without it.
 */
export function TeachingJobsBoard({ board }: { board: TeachingBoard }) {
  if (!board.known || board.jobs.length === 0) return null
  const summary = boardSummary(board.jobs)
  return (
    <div className="mt-8 max-w-3xl">
      <p className="text-base leading-relaxed text-body">
        {summaryLead(summary, board.day).map((s, i) =>
          s.href ? (
            <a key={i} href={s.href} className="font-semibold text-accent-foreground hover:underline">
              {s.text}
            </a>
          ) : (
            <Fragment key={i}>{s.text}</Fragment>
          ),
        )}
      </p>
      {boardSections(board.jobs).map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="mt-10 scroll-mt-24">
          <h2 id={`${s.id}-title`} className="h-section text-foreground">
            {sectionHeading(s)}
          </h2>
          {s.jobs.length > 0 ? (
            <Rows bordered className="mt-3">
              {s.jobs.map((j) => {
                // The apply-by date last, at one place in every row: on a phone it ends the line, from sm it is a column at the row's
                // right edge, its separator dropped and the text column leaving it 11rem ("Apply by 30 May 2027" is ~149px at 14px in
                // Open Runde, so a ~26px gutter) (2026-11-07 audit: with no employer named the date led the line, so the deadlines did
                // not line up down the list). One copy in the DOM, read in line order. Only a row with a date leaves the date its
                // 11rem: a direct post may carry none (an imported job always has one, job-listing.ts), and an undated title gave up
                // 176px to an empty column, wrapping at ~390px of a 564px column at 640 (2026-11-06 gate review).
                const parts = jobMetaParts(j)
                const rest = parts.filter((p) => !p.due)
                const due = parts.find((p) => p.due)
                return (
                  <Row key={j.id} className="py-0">
                    <Link href={`/listings/${j.id}`} prefetch={false} className="group relative grid grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 py-4">
                      <span className={due ? 'min-w-0 sm:pr-44' : 'min-w-0'}>
                        <span className="block text-base font-bold text-foreground group-hover:text-accent-foreground [overflow-wrap:anywhere]">{j.title}</span>
                        {/* The pay, where a posting states one, on its own line under the title, as a price sits under a card's title; the
                            employer, source and apply-by date follow (2026-11-06 audit: the pay sat mid-sentence in the line below). */}
                        {j.pay && <span className="mt-1 block text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{j.pay}</span>}
                        {/* No line when the pay was all it held: an empty block left a 4px gap under the pay (2026-11-06 gate review). The
                            apply-by date in the title's ink, on one line, so a reader running down the list picks out each row's deadline;
                            the employer and the source stay in body ink (2026-11-07 audit). From sm a date alone leaves this line nothing
                            in flow, the date being the column at the row's right edge, so there the line drops its margin: the empty block's
                            mt-1 was that 4px gap again, under the title or the pay (2026-11-06 gate review). */}
                        {jobMeta(j) && (
                          <span className={`mt-1 block text-sm leading-relaxed text-body [overflow-wrap:anywhere]${due && rest.length === 0 ? ' sm:mt-0' : ''}`}>
                            {rest.map((p) => p.text).join(' · ')}
                            {due && rest.length > 0 && <span className="sm:hidden">{' · '}</span>}
                            {due && <span className="whitespace-nowrap text-foreground sm:absolute sm:right-7 sm:top-1/2 sm:-translate-y-1/2">{due.text}</span>}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="size-4 text-ink-4 group-hover:text-accent-foreground" aria-hidden />
                    </Link>
                  </Row>
                )
              })}
            </Rows>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-body">{emptySectionLine(s)}</p>
          )}
        </section>
      ))}
      {/* Where the postings come from, how many state the pay and the span of the apply-by dates: after the jobs, not between
          the count and the first one, where the paragraph ran ten lines on a phone (2026-11-06 audit). */}
      <p className="mt-10 text-sm leading-relaxed text-body">{summaryRest(summary, SITE_NAME)}</p>
    </div>
  )
}
