import Link from 'next/link'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LocalizedLink } from '@/components/marketplace/localized-link'
import { SITE_NAME } from '@/lib/edition'
import { cn } from '@/lib/utils'
import { COLUMN } from './column'

/**
 * The classroom's own top bar: the eno mark + "Classroom", and the way back to the marketplace. Nothing else — the
 * marketplace header's search, post button and account rail belong to a different app (owner: "super clean").
 * A server component: it carries no personal data and needs no hydration.
 * Mobile first: the row is the page's phone-width column (column.ts), both links are 44px tall tap targets (their
 * padding is pulled back with a negative margin, so the mark and the label still sit on the column's edges), and the
 * bar clears the status bar / notch — env() on iOS and recent Android WebViews, Capacitor's injected property on older ones.
 */
export function ClassroomHeader() {
  return (
    <header className="sticky top-0 z-nav border-b border-border bg-background/95 pt-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))] backdrop-blur material">
      <div className={cn(COLUMN, 'flex h-14 items-center justify-between gap-3')}>
        {/* The visible wordmark beside the mark carries the translated "Lớp học"; the link's name is the product's. */}
        {/* i18n-invariant: "eno Classroom" is the product's NAME, a brand — not words to translate. */}
        <Link href="/classroom" prefetch={false} className="press -ml-2 flex min-h-11 items-center gap-2 rounded-xl px-2" aria-label={`${SITE_NAME} Classroom`}>
          {/* The eno "e" mark — the stamp must match public/logo-mark.svg (src/lib/asset-stamps.test.ts). */}
          <img src="/logo-mark.svg?v=2b609517" alt="" width={1024} height={1024} className="h-9 w-9" />
          <span className="text-lg font-bold text-ink">
            <Bilingual en="Classroom" vi="Lớp học" />
          </span>
        </Link>
        {/* The marketplace home in the reader's language: a bare "/" is English-pinned since the /vi pilot (582e17169). */}
        <LocalizedLink href="/" prefetch={false} className="press -mr-3 flex min-h-11 items-center rounded-xl px-3 text-sm text-body hover:text-ink">
          {SITE_NAME}
        </LocalizedLink>
      </div>
    </header>
  )
}
