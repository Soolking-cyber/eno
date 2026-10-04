import { Fragment } from 'react'
import { Bilingual } from '@/components/marketplace/bilingual'
import { detectContentLang, readsAsVietnamese } from '@/lib/detect-lang'
import type { FacetDef } from '@/lib/taxonomy'

/**
 * One part of a Details value: an OPTION the facet lists (its authored en/vi pair), or a RAW value printed
 * as stored, with the language its script shows (`lang`, null when the script cannot tell).
 */
export type FacetValuePart =
  | { kind: 'option'; en: string; vi: string }
  | { kind: 'raw'; text: string; lang: string | null }

const norm = (s: string) => s.normalize('NFC').trim().toLowerCase()

/** "2 PN" → { count: '2', unit: 'PN' }, "1–2 khách", "6+ BR", "9+ seats": an option label that states its own
 *  count AND unit — facet-chip-label.ts's test (a leading digit and a letter). */
function countAndUnit(label: string): { count: string; unit: string } | null {
  const m = /^(\d[\d.,]*(?:\s*[–-]\s*\d[\d.,]*)?\+?)\s*(\p{L}.*)$/u.exec(label.trim())
  return m ? { count: m[1], unit: m[2].trim() } : null
}

/** Does the unit say the facet's label again? Its last word ("Seats" / "Số chỗ" / "Số khách"), or an all-caps
 *  abbreviation whose letters run through the label from its first one ("BR" for "Bedrooms", "PN" for "Phòng ngủ"). */
function unitRestatesLabel(unit: string, label: string): boolean {
  const u = norm(unit)
  const words = norm(label).split(/\s+/).filter(Boolean)
  if (!u || !words.length) return false
  if (words[words.length - 1] === u) return true
  if (!/^\p{Lu}{2,3}$/u.test(unit)) return false
  const letters = words.join('')
  if (letters[0] !== u[0]) return false
  let at = 0
  for (const ch of u) {
    at = letters.indexOf(ch, at)
    if (at < 0) return false
    at++
  }
  return true
}

/**
 * ⛔ THE ROW'S LABEL ALREADY NAMES THE UNIT — "Phòng ngủ: 2 PN", "Số chỗ: 4 chỗ", "Số khách: 1–2 khách" said it
 * twice (review, 2026-10-04). The filter chip has the same rule (facet-chip-label.ts: an option that states
 * its own count and unit is the whole chip, so "Bedrooms: 2 BR" is never printed); a Details row cannot drop
 * its label, so here the VALUE drops the unit instead — "Phòng ngủ: 2".
 * ⚠️ ONLY A UNIT THAT RESTATES THE LABEL, AND ONLY ONE EVERY OPTION SHARES. "Bộ nhớ: 128 GB", "Thời hạn: 7
 * ngày", "Công suất: 65W" keep theirs — the unit is the information there. And "Độ tuổi" names its unit
 * ('tuổi') but mixes it with 'tháng' across its options ("0–6 tháng", "1–3 tuổi"), so it keeps both.
 */
function withoutRestatedUnit(label: string, facetLabel: string, siblingLabels: readonly string[]): string {
  const cu = countAndUnit(label)
  if (!cu || !unitRestatesLabel(cu.unit, facetLabel)) return label
  const unit = norm(cu.unit)
  const shared = siblingLabels.map(countAndUnit).every((x) => !x || norm(x.unit) === unit)
  return shared ? cu.count : label
}

/**
 * A Details VALUE whose key is a taxonomy facet, in the reader's language: each stored value through
 * the facet's own option pair ('daily' → 'Theo ngày'), never through `<Tr>`.
 *
 * ⚠️ A value the facet does not list (a legacy or foreign writer's word) prints AS STORED. It must not
 * fall through to `<Tr>`, which sends it to the machine-translation layer: a slug like 'at-customer'
 * or an old free word would come back "translated" into something the seller never said.
 * ⚠️ A LEGACY ROW THAT STORED THE LABEL ("Số tự động", "Automatic") IS STILL THAT OPTION (review,
 * 2026-10-04): matched on the value first, then on either label exactly, so it reads in the reader's
 * language — never the stored Vietnamese on an English page.
 * ⚠️ An ARRAY value (an importer's multi-valued attribute) maps ELEMENT BY ELEMENT — `String(['a','b'])`
 * is 'a,b', which matches no option and would print the raw slugs.
 */
export function facetValueParts(facet: FacetDef, value: unknown): FacetValuePart[] {
  const values = (Array.isArray(value) ? value : [value]).map((v) => String(v ?? '').trim()).filter(Boolean)
  return values.map((v): FacetValuePart => {
    const n = norm(v)
    const option =
      facet.options.find((o) => o.value === v) ??
      facet.options.find((o) => norm(o.value) === n) ??
      facet.options.find((o) => norm(o.label) === n || norm(o.labelVi) === n)
    // The script's language: another script, or a Vietnamese-only letter (detectContentLang), else Vietnamese
    // by its stacked tones ('Số vô cấp' — readsAsVietnamese); plain Latin stays null, never guessed.
    if (!option) return { kind: 'raw', text: v, lang: detectContentLang(v) ?? (readsAsVietnamese(v) ? 'vi' : null) }
    return {
      kind: 'option',
      en: withoutRestatedUnit(option.label, facet.label, facet.options.map((o) => o.label)),
      vi: withoutRestatedUnit(option.labelVi, facet.labelVi, facet.options.map((o) => o.labelVi)),
    }
  })
}

/**
 * Whether the value's FIRST part prints as stored (the facet lists no such option). Only then does the
 * Details cell raise its first letter: an option label is already written in its own case, and
 * `first-letter:uppercase` turned 'eSIM', 'iPhone 17', 'microSD', 'vivo' and 'iTel' into 'ESIM',
 * 'IPhone 17', 'MicroSD', 'Vivo' and 'ITel' (the page.tsx sentence-case note).
 */
export function facetValueStartsRaw(facet: FacetDef, value: unknown): boolean {
  return facetValueParts(facet, value)[0]?.kind === 'raw'
}

/**
 * The value, part by part. A raw part whose SCRIPT names another language than the page's (a stored
 * Vietnamese word with no option behind it, on an English page) carries that `lang`, so a screen reader
 * voices it in the right language. ⚠️ Plain Latin says nothing — 'cvt' may be a code, English, or
 * Vietnamese typed without marks — so such a part is left unmarked rather than guessed at.
 */
export function FacetValue({ facet, value, pageLang }: { facet: FacetDef; value: unknown; pageLang?: string }) {
  return (
    <>
      {facetValueParts(facet, value).map((p, i) => (
        <Fragment key={i}>
          {i > 0 && ', '}
          {p.kind === 'option'
            ? <Bilingual en={p.en} vi={p.vi} />
            : p.lang && p.lang !== pageLang ? <span lang={p.lang}>{p.text}</span> : p.text}
        </Fragment>
      ))}
    </>
  )
}
