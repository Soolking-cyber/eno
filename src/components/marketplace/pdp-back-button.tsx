'use client'

import Link from 'next/link'
import { ChevronLeftIcon } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { iconButtonClass } from '@/components/ui/icon-button'
import { useLanguage } from '@/context/language-context'
import { useSafeBack } from '@/lib/safe-back'

/**
 * BACK, OVER THE LISTING'S PHOTO (owner, 2026-11-10: "1-6 1 by one go", item 3 of the decision scorecard).
 *
 * On a phone a listing with photos opens on the photo: the site header is not shown there (globals.css, the
 * `[data-photo-first]` rules, which also say where and why not), so the way back the header's logo and the browser gave
 * needs a control of its own. It sits top-left over the photo, opposite Share and Save, in the same over-media ink
 * (ui/icon-button `overlay`: no chip, owner 2026-08-18).
 *
 * ⛔ A REAL LINK TO `fallbackHref`, WHOSE TAP POPS (src/lib/safe-back.ts, which is written for exactly this pairing). The
 * header is hidden by a stylesheet rule, with or without script, so its replacement must work the same way: before the
 * page hydrates, or with script off, the arrow is an ordinary link to the listing's category. Once hydrated the tap is
 * intercepted: with one of our own pages behind it, Back returns there and the feed restores its scroll; opened cold from
 * a shared link or a search result, it goes to the category. Never a dead tap, never off the site. (The first version
 * was a button with only a click handler: commit review, 2026-11-10.)
 * ⚠️ `prefetch={false}`: every listing view would otherwise prefetch its category page for a link most readers never
 * follow as a link.
 *
 * ⚠️ `hidden` BY DEFAULT, SHOWN BY THE SAME RULE THAT HIDES THE HEADER. The page's HTML is one document for every width and
 * shell; a browser that cannot evaluate that rule (no `:has()`) keeps the header and never sees this arrow, so the two can
 * not both be missing or both be there.
 */
export function PdpBackButton({ fallbackHref }: { fallbackHref: string }) {
  const { tr } = useLanguage()
  const onBack = useSafeBack(fallbackHref)
  return (
    // Classes on the BUTTON: `asChild` hands them to the link, and only these go through tailwind-merge.
    <Button asChild variant="bare" size="none" className={iconButtonClass({ size: 'md', variant: 'overlay', className: 'icon-own-ink press hidden' })}>
      <Link href={fallbackHref} prefetch={false} onClick={onBack} data-photo-back="" aria-label={tr('Back', 'Quay lại')}>
        {/* ChevronLeftIcon, not ChevronLeft: the one in the core sprite, as in the header's own Back. `size-5`, not h-5 w-5:
            ui/button resizes any icon that carries no `size-` class to 16px. */}
        <ChevronLeftIcon className="size-5" aria-hidden />
      </Link>
    </Button>
  )
}
