'use client'

import { useLanguage } from '@/context/language-context'
import { detectContentLang } from '@/lib/detect-lang'
import { linkifyLegal } from '@/components/marketplace/legal-linkify'

/** A paragraph (or table cell) of a legal page, authored in both languages. */
export type LegalCopy = { en: string; vi: string }

/**
 * One legal paragraph in the reader's language: the AUTHORED Vietnamese for `vi`, the English for
 * `en`, and a machine translation of the English for the nine other languages (`tr(en, vi)` — the
 * same rule <Bilingual> applies to AFFILIATION and PROVIDER_OF_RECORD). Document paths and mailboxes
 * become links without a character of the wording changing (legal-linkify.tsx).
 *
 * ⚠️ NOT <Tr>/<LinkifiedTr>: those send the English through the translation layer for Vietnamese too,
 * so the server-rendered Vietnamese of a legal page was whatever the MT provider returned. A legal
 * paragraph is approved as a pair, and the pair is what renders.
 * ⚠️ The strings arrive as props from a server page, so scripts/gen-ui-strings.mjs does not harvest
 * them into the shipped catalogue — which is what keeps services-only legal copy out of eno.vn's.
 */
export function LegalText({ en, vi }: LegalCopy) {
  const { tr, lang } = useLanguage()
  const out = tr(en, vi)
  const cl = detectContentLang(out)
  const nodes = linkifyLegal(out)
  return cl && cl !== lang ? <span lang={cl}>{nodes}</span> : <>{nodes}</>
}

/**
 * A small legal table — the recipients and on-device storage tables on /privacy.
 *
 * ⚠️ ONE TABLE AT EVERY WIDTH, RESTYLED BELOW md, NOT A SIDEWAYS SCROLLER (the /hcmc-rent-index
 * pattern). Four columns of prose do not fit a phone; below md each row becomes its first cell as a
 * heading over the remaining cells, each labelled with its column, and the header row stays in the
 * DOM for assistive tech. From md it is a plain table.
 */
export function LegalTable({ caption, head, rows }: { caption: LegalCopy; head: LegalCopy[]; rows: LegalCopy[][] }) {
  return (
    <table className="w-full text-sm max-md:block">
      <caption className="mb-2 text-left text-sm font-semibold text-foreground max-md:block"><LegalText {...caption} /></caption>
      <thead className="max-md:sr-only">
        <tr className="text-left text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={i} scope="col" className="pb-2 pr-4 align-bottom font-semibold"><LegalText {...h} /></th>
          ))}
        </tr>
      </thead>
      <tbody className="max-md:block">
        {rows.map((row, r) => (
          <tr key={r} className="border-t border-border align-top max-md:block max-md:py-3">
            {row.map((cell, c) =>
              c === 0 ? (
                <th key={c} scope="row" className="py-2 pr-4 text-left font-semibold text-foreground max-md:block max-md:py-0 max-md:pb-1">
                  <LegalText {...cell} />
                </th>
              ) : (
                <td key={c} className="py-2 pr-4 leading-relaxed text-body max-md:block max-md:py-0.5">
                  <span className="text-xs font-semibold text-muted-foreground md:hidden"><LegalText {...head[c]} />: </span>
                  <LegalText {...cell} />
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
