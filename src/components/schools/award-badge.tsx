'use client'

import Link from 'next/link'
import { Award } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { AWARDS_PATH } from '@/lib/schools/constants'

/**
 * A school's Teachers' Choice place (src/lib/schools/awards.ts), linking to that year's results. rank 1 = the
 * teachers' choice of its kind, 2–3 = finalist. ⚠️ No superlative (Vietnamese advertising rules).
 */
export function AwardBadge({ year, rank }: { year: number; rank: number }) {
  const { tr } = useLanguage()
  const text = rank === 1
    ? tr("Teachers' Choice {y}", 'Giáo viên bình chọn {y}').replace('{y}', String(year))
    : tr("Teachers' Choice {y} finalist", 'Vào chung kết Giáo viên bình chọn {y}').replace('{y}', String(year))
  return (
    <Link href={`${AWARDS_PATH}/${year}`} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand hover:underline dark:bg-brand/20">
      <Award aria-hidden className="size-3.5" />
      {text}
    </Link>
  )
}
