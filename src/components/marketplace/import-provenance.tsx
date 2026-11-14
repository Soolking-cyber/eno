'use client'

import { useLanguage } from '@/context/language-context'
import { provenanceParts, type ProvenanceKind } from '@/lib/import-provenance-copy'
import { cn } from '@/lib/utils'

/**
 * WHERE AN IMPORTED LISTING CAME FROM — one quiet line under the CTA (SEO wave B, P1).
 *
 * "Source: Nhatot.com · posted there on 12 Sep 2026 · original ad". The server decides the kind, the
 * site and the date (import-provenance.ts); this leaf only words it in the reader's language, because
 * the listing page is one ISR-cached HTML for every reader.
 *
 * ⚠️ HYDRATION-SAFE BY CONSTRUCTION: `lang` is seeded from the [lang] route on the server and in the
 * first client render (language-context.tsx), and the copy reads no clock and no Intl
 * (import-provenance-copy.ts). import-provenance.test.tsx hydrates the server HTML to prove it.
 *
 * ⚠️ THE LINK IS THE CTA'S LINK, WITH THE CTA'S `rel` (decision P-d). Same href, so it can never point
 * somewhere the button does not; same `sponsored nofollow noopener noreferrer`, because a second
 * anchor to the same outbound URL without `sponsored` would be the undisclosed paid link that rel
 * exists to avoid. `relative tap-44`: the 44px hit area is an absolutely positioned pseudo-element,
 * and without `relative` it anchors to some distant ancestor instead of the link.
 * ⛔ NO `-mt-2` TO TUCK IT UNDER THE BUTTON. On a 16px line the 44px hit area overhangs 14px above
 * the link; at the column's 8px-tightened gap it covered the CTA's bottom 6px, and being later in the
 * DOM it took those taps — measured with an elementsFromPoint grid on a production build: 24 to 36
 * CTA points hit-tested to this link, on every width and language. The column's full 16px gap clears it.
 */
/**
 * ⛔ `look="counsel"` — THE GOODS SHEET'S SOURCE LINE, SAID ONCE IN THE PAGE BELOW md (owner-approved 2026-11-15 (build 7), cook
 * r07 "item"; src/lib/goods-sheet.ts). It reverses r06's `inline` (the line as the pinned tier's 13px centred note, under the
 * button on every screen): the pinned tier is the button alone, and the page renders a SECOND copy of this line where it
 * belongs — in Seller information in place of its "Source: <shop>" row (14px), or as the seller band's last line (13px) — while
 * the tier's copy is `max-md:hidden` (`className`). The caller sets the size and the breakpoint (`md:hidden` on this copy); the
 * look is the counsel's: muted text, and the link an ordinary link in running text — the accent, regular weight, UNDERLINED
 * (axe link-in-text-block), WITHOUT `tap-44` (WCAG 2.5.8's inline exception). Same href, rel and target as the CTA.
 * ⚠️ It carries `data-provenance-line="counsel"`, NOT `data-import-provenance`: that hook names the ONE line under the CTA
 * (e2e/ci/provenance.spec.ts counts it), and the two copies are never displayed at the same width.
 */
export function ImportProvenance({ kind, site, iso, href, look = 'cta', className }: { kind: ProvenanceKind; site: string; iso: string | null; href: string; look?: 'cta' | 'counsel'; className?: string }) {
  const { lang, tr } = useLanguage()
  const p = provenanceParts({ kind, site, iso }, lang, tr)
  if (!p) return null
  const counsel = look === 'counsel'
  return (
    <p data-import-provenance={counsel ? undefined : true} data-provenance-line={counsel ? 'counsel' : undefined} className={cn(counsel ? 'text-muted-foreground' : 'text-xs text-body', className)}>
      {p.before}
      {p.date && p.dateTime ? <time dateTime={p.dateTime}>{p.date}</time> : null}
      {p.after}
      {' · '}
      <a
        href={href}
        target="_blank"
        rel="sponsored nofollow noopener noreferrer"
        className={counsel
          ? 'text-accent-foreground underline underline-offset-3 active:opacity-60'
          : 'relative tap-44 font-medium text-accent-foreground underline-offset-2 hover:underline'}
      >
        {p.link}
        <span className="sr-only"> {p.newTab}</span>
      </a>
    </p>
  )
}
