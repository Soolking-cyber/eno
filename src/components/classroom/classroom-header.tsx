import Link from 'next/link'
import { Bilingual } from '@/components/marketplace/bilingual'
import { SITE_NAME } from '@/lib/edition'

/**
 * The classroom's own top bar: the eno mark + "Classroom", and the way back to the marketplace. Nothing else — the
 * marketplace header's search, post button and account rail belong to a different app (owner: "super clean").
 * A server component: it carries no personal data and needs no hydration.
 */
export function ClassroomHeader() {
  return (
    <header className="sticky top-0 z-nav border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur material">
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4 sm:px-6">
        {/* The visible wordmark beside the mark carries the translated "Lớp học"; the link's name is the product's. */}
        {/* i18n-invariant: "eno Classroom" is the product's NAME, a brand — not words to translate. */}
        <Link href="/classroom" prefetch={false} className="press flex items-center gap-2 rounded-xl" aria-label={`${SITE_NAME} Classroom`}>
          {/* The eno "e" mark — the stamp must match public/logo-mark.svg (src/lib/asset-stamps.test.ts). */}
          <img src="/logo-mark.svg?v=2b609517" alt="" width={1024} height={1024} className="h-9 w-9" />
          <span className="text-lg font-bold text-ink">
            <Bilingual en="Classroom" vi="Lớp học" />
          </span>
        </Link>
        <Link href="/" prefetch={false} className="press rounded-xl px-2 py-1 text-sm text-body hover:text-ink">
          {SITE_NAME}
        </Link>
      </div>
    </header>
  )
}
