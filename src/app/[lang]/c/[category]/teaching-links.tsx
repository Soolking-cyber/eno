'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ArrowRight } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { POSTING_IS_FREE } from '@/lib/site-identity'
import { TEACH_HUB_PATH } from '@/lib/teach-guides/hub-path'
import { formatCountFull } from './category-copy'

/**
 * THE TWO TEACHING SURFACES POINT AT EACH OTHER (nav audit N8, 2026-10-05).
 *
 * /c/teachers lists teacher PROFILES — people offering to teach, for schools and companies to hire — and
 * Jobs › Teaching lists the jobs. An expat teacher looking for work tapped "Teachers" and found one profile
 * and no jobs; a teacher browsing jobs who would rather be found had no road to the profile form. One line
 * each way, under the page's lede:
 *  · /c/teachers: "Looking for a teaching job? Jobs › Teaching (N)" — only while N > 0, so it never sends
 *    anyone to an empty aisle;
 *  · /c/jobs: "Want schools to find you? Create a teacher profile" → /teachers/join. Not "Teach privately?":
 *    only schools and businesses can message a teacher profile, so that line would promise families who never come.
 *
 * Client components for category-text.tsx's reason: the words follow the visitor's language even when the
 * choice cannot be persisted. The hrefs come from the page, already through localizedHref (A1-LANG) — the
 * explorer link is the `/vi` twin on a Vietnamese page. That one is rel="nofollow" + prefetch={false} like
 * every explorer link on /c (it canonicalises to `/`, and a prefetch would render the whole explorer).
 * ⚠️ ENGLISH IN LITERAL tr() PAIRS: scripts/gen-ui-strings.mjs pre-translates only literals.
 */
export function TeachingJobsLink({ count, href }: { count: number; href: string }) {
  const { lang, tr } = useLanguage()
  if (count <= 0) return null
  return (
    <p className="mt-3 max-w-prose text-sm text-body">
      {tr('Looking for a teaching job?', 'Tìm việc dạy học?')}{' '}
      <Link href={href} rel="nofollow" prefetch={false} data-cross-link="teaching-jobs" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
        {tr('Jobs › Teaching', 'Việc làm › Giảng dạy')} ({formatCountFull(count, lang)}) <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    </p>
  )
}

/**
 * ⛔ THE TEACHER LIBRARY, ONE LINE UNDER A TEACHING PAGE'S LEDE (teacher visibility plan, 2026-10-18). /c/teachers and
 * /c/jobs are where teachers arrive, and neither linked the hub — the library was reachable only from the sitemap and
 * its own guides (src/lib/teach-guides/site-links.ts has the measurement).
 * ⚠️ THE GUIDES ARE ENGLISH-ONLY, so the Vietnamese line says so in its own words and the link declares `hrefLang="en"`
 * (never `lang="en"`: that attribute describes the link TEXT, which is Vietnamese on a Vietnamese page).
 */
export function TeachGuideLink({ className }: { className?: string }) {
  const { tr } = useLanguage()
  return (
    <p className={cn('mt-3 max-w-prose text-sm text-body', className)}>
      {tr('New to teaching in Vietnam?', 'Mới dạy học ở Việt Nam?')}{' '}
      <Link href={TEACH_HUB_PATH} hrefLang="en" data-cross-link="teach-guide" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
        {tr('Start with the guide', 'Đọc cẩm nang (tiếng Anh)')} <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    </p>
  )
}

/**
 * /c/jobs → the teacher profile form (the other half of the pair above). Also under a TEACHING JOB's details (owner,
 * 2026-10-12: a teacher reading a job may rather be found — the PDP passes its `order-*` slot as `className`).
 */
export function TeacherProfileLink({ href, className }: { href: string; className?: string }) {
  const { tr } = useLanguage()
  return (
    <p className={cn('mt-3 max-w-prose text-sm text-body', className)}>
      {tr('Want schools to find you?', 'Muốn trường học tìm đến bạn?')}{' '}
      <Link href={href} data-cross-link="teacher-profile" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
        {tr('Create a teacher profile', 'Tạo hồ sơ giáo viên')} <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    </p>
  )
}

/**
 * ⛔ THE SCHOOL SIDE'S WAY IN (teacher visibility plan §4 channel 6 "Now"; copy approved in the plan, 2026-10-18 — owner: "go
 * with recommended"). Until this prompt every job on /c/jobs was a LINKED one — it opens the original posting, where you
 * apply (the lede, live 2026-10-18: "Every listing here links to its original on a job site"; it is tiered by the linked
 * share, category-copy.ts linkedTier, so a school's own post turns it to "Most…" by itself) — and nothing on a teaching
 * job's page, /c/jobs or /schools asked a school to post its own. One prompt —
 * on a teaching job's page in one group with the teacher's line, on /c/jobs after the teacher lines, and in /schools' link
 * row: "Hiring? Post your job ad free on eno", to the post form with Jobs picked. The page passes `/post?category=jobs`
 * through localizedHref, like every href in this file. With no draft to resume, the wizard opens on that category with its
 * FIRST intent picked, and Jobs' first is Hiring (`job`) — never "Looking for work", which in Teaching would hold Publish
 * behind the teacher-profile card (taxonomy.ts TEACHER_SEEKING_POST). post-wizard.services-entry.test.tsx renders that
 * landing on both editions.
 * ⛔ IT PROMISES ONLY WHAT IS TRUE TODAY: the ad goes up on eno (no photo needed for a job, up to 5,000 characters of
 * description, live once published), and its page carries Chat now, so teachers write to the school in eno's chat — where
 * a linked job is applied for on another site. NOT the plan's "your FULL job ad": a pasted ad is rarely publishable whole —
 * the publish guard refuses contact details in the text (phone, email, links, handles), and the job-text screen refuses
 * the lines a job ad may not carry (job-listing.ts jobTextProblem, which ships with this prompt) — so "full" would promise
 * what the Publish button then refuses. NOT "…and appear in Google's job search": eno marks up no job yet, and the plan
 * adds that clause only once first-party JobPosting is live.
 * ⚠️ "FREE" ONLY THROUGH POSTING_IS_FREE (site-identity.ts — the fee clauses of the Terms and the Regulations, both
 * editions), in two literal tr() pairs as the footer has them: the day a fee is announced, the word goes with the flag.
 * ⚠️ prefetch={false}, WARMED ON INTENT: /post is prerendered, so Next's viewport prefetch fetches the wizard's route for
 * every visitor who merely sees the link — the largest of its six chunks alone was 30.9 KiB of unused JS (measured on
 * prod 2026-08-23, listings-explorer.tsx warmPost) — and this line sits near the top of /c/jobs and /schools. Pointer-down
 * (touch) and mouse-enter (desktop hover) warm it, as warmPost does, so a tap still lands instantly.
 * Both editions, like TeacherProfileLink: the post form is on both. `row`: the whole prompt is the link, in the classes
 * of the row it joins (/schools' link row, the shape of its "Missing a school? Suggest it") — no paragraph, no arrow.
 */
export function PostJobLink({ href, row = false, className }: { href: string; row?: boolean; className?: string }) {
  const { tr } = useLanguage()
  const router = useRouter()
  const warm = () => router.prefetch(href)
  // The question avoids a second "tuyển dụng" in one line — both external reviewers, 2026-10-18, read the first draft
  // ("Đăng miễn phí tin tuyển dụng đầy đủ") as translated.
  const ask = tr('Hiring?', 'Bạn cần tuyển người?')
  const act = POSTING_IS_FREE
    ? tr('Post your job ad free on eno', 'Đăng tin tuyển dụng miễn phí trên eno')
    : tr('Post your job ad on eno', 'Đăng tin tuyển dụng trên eno')
  if (row) {
    return (
      <Link href={href} prefetch={false} onPointerDown={warm} onMouseEnter={warm} data-cross-link="post-job" className={className}>
        {ask}{' '}{act}
      </Link>
    )
  }
  return (
    <p className={cn('mt-3 max-w-prose text-sm text-body', className)}>
      {ask}{' '}
      <Link href={href} prefetch={false} onPointerDown={warm} onMouseEnter={warm} data-cross-link="post-job" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
        {act} <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    </p>
  )
}
