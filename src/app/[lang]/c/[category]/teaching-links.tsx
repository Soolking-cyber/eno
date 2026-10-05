'use client'

import Link from 'next/link'
import { ArrowRight } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
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

/** /c/jobs → the teacher profile form (the other half of the pair above). */
export function TeacherProfileLink({ href }: { href: string }) {
  const { tr } = useLanguage()
  return (
    <p className="mt-3 max-w-prose text-sm text-body">
      {tr('Want schools to find you?', 'Muốn trường học tìm đến bạn?')}{' '}
      <Link href={href} data-cross-link="teacher-profile" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
        {tr('Create a teacher profile', 'Tạo hồ sơ giáo viên')} <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    </p>
  )
}
