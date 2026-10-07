import Link from 'next/link'
import { LocalizedLink } from '@/components/marketplace/localized-link'
import { Bilingual } from '@/components/marketplace/bilingual'
import { CalendarDays } from '@/components/ui/icons'

/**
 * COVER LESSONS PROMO (2026-10-07) — a small two-sided card for pages both teachers and schools read (/schools).
 * Teachers are the main readers there, so it leads with them; schools get the direct door to the cover filter.
 * Server-renderable: its words come through <Bilingual>, a client island, like the page around it.
 */
export function CoverPromoCard({ className }: { className?: string }) {
  return (
    <section aria-labelledby="cover-promo" className={['space-y-2 rounded-2xl bg-tint p-4', className].filter(Boolean).join(' ')}>
      <h2 id="cover-promo" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <CalendarDays className="size-4 text-brand" />
        <Bilingual en="Cover lessons" vi="Dạy thay" />
      </h2>
      <p className="text-sm text-body">
        <Bilingual en="Teachers: show the periods you are free and pick up one-off lessons near you." vi="Giáo viên: cho biết các buổi bạn rảnh và nhận dạy thay gần bạn." />
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/teachers/cover" className="font-semibold text-brand underline"><Bilingual en="How it works" vi="Cách hoạt động" /></Link>
        {/* `/` is the English-pinned home — LocalizedLink sends a Vietnamese reader to its `/vi` twin. */}
        <LocalizedLink href="/?category=teachers&attr_cover=open" rel="nofollow" prefetch={false} className="font-semibold text-brand underline"><Bilingual en="Schools: find a cover teacher" vi="Trường học: tìm giáo viên dạy thay" /></LocalizedLink>
      </p>
    </section>
  )
}
