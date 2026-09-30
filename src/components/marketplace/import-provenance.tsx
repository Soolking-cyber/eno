'use client'

import { useLanguage } from '@/context/language-context'
import { provenanceParts, type ProvenanceKind } from '@/lib/import-provenance-copy'

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
export function ImportProvenance({ kind, site, iso, href }: { kind: ProvenanceKind; site: string; iso: string | null; href: string }) {
  const { lang, tr } = useLanguage()
  const p = provenanceParts({ kind, site, iso }, lang, tr)
  if (!p) return null
  return (
    <p data-import-provenance className="text-xs text-body">
      {p.before}
      {p.date && p.dateTime ? <time dateTime={p.dateTime}>{p.date}</time> : null}
      {p.after}
      {' · '}
      <a
        href={href}
        target="_blank"
        rel="sponsored nofollow noopener noreferrer"
        className="relative tap-44 font-medium text-accent-foreground underline-offset-2 hover:underline"
      >
        {p.link}
        <span className="sr-only"> {p.newTab}</span>
      </a>
    </p>
  )
}
