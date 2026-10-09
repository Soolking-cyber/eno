import type { FacetDef } from '@/lib/taxonomy'
import { formatInteger, moneyLocale } from '@/lib/vnd'

type Tr = (en: string, vi: string) => string

/**
 * WHAT ONE FACET OPTION IS CALLED — the one rule every reader of an option label shares (the Filter panel, the facet
 * pills, the applied-filter chip below):
 *  · a `placeNames` facet's option is a PLACE: its own English or Vietnamese name, never sent through `tr()` — a
 *    district or a province is never machine-translated (PlaceName's rule); English for every other language;
 *  · ⚠️ except an option marked `word` ("Can teach in"'s Online and "Will move anywhere", teacher onboarding
 *    redesign, 2026-10-08) — a word, translated like any other label;
 *  · every other facet's option is copy: `tr(label, labelVi)`.
 */
export function facetOptionLabel(facet: Pick<FacetDef, 'placeNames'>, opt: FacetDef['options'][number], lang: string, tr: Tr): string {
  if (facet.placeNames && !opt.word) return lang === 'vi' ? opt.labelVi : opt.label
  return tr(opt.label, opt.labelVi)
}

/**
 * WHAT AN APPLIED CUSTOM FILTER'S CHIP SAYS (E-ACTIVE, 2026-09-29) — "Bedrooms: 2 BR", "Size 30–80 m²".
 *
 * ⛔ IT USED TO SAY THE STATE KEY: `${key}: ${value}` printed "bedrooms: 2" and "areaM2: 30-80" on the
 * result line, in the empty state's "Remove:" row and in the saved-search receipt — a debug string on
 * the one line that tells a reader what is narrowing their feed.
 *
 *  · RANGE facets ("lo-hi", either side open): the facet's label, then the span in its unit —
 *    "Size 30–80 m²", "Year ≥ 2020", "Mileage ≤ 50,000 km". Numbers group by the reader's language
 *    only where the facet's own control groups them (RangeFacetControl: `max >= 10000`, whole steps),
 *    so a year reads "2020", never "2,020".
 *  · OPTION facets: "Label: Option" — except where the option already names its unit ("2 BR",
 *    "4 seats", "2 PN"), which is the whole chip on its own; "Bedrooms: 2 BR" says bedrooms twice.
 *  · Anything the taxonomy no longer describes falls back to the old `key: value` rather than
 *    vanishing: a chip must exist for every filter that narrows the feed, or it cannot be removed.
 *
 * ⚠️ DISPLAY ONLY. The URL, the request and the saved-search PARAMS are keyed as before; this is the
 * label ResultLine keys removals on (listings-explorer's `id = label` rule), so it must be stable for
 * a given filter, which it is — a pure function of the facet, the value and the language.
 */
export function customFilterChipLabel(facet: FacetDef | undefined, key: string, value: string, lang: string, tr: Tr): string {
  if (!facet) return `${key}: ${value}`
  const name = tr(facet.label, facet.labelVi)
  if (facet.kind === 'range' && facet.range) {
    const [a = '', b = ''] = value.split('-')
    const lo = a !== '' ? Number(a) : null
    const hi = b !== '' ? Number(b) : null
    if ((lo != null && !Number.isFinite(lo)) || (hi != null && !Number.isFinite(hi)) || (lo == null && hi == null)) return `${key}: ${value}`
    const { max, step, unit } = facet.range
    const loc = moneyLocale(lang)
    const num = (n: number) => {
      if (step < 1) {
        const t = (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '')
        return loc === 'vi' ? t.replace('.', ',') : t
      }
      return max >= 10000 ? formatInteger(n, loc) : String(Math.round(n))
    }
    const u = unit ? ` ${unit}` : ''
    if (lo != null && hi != null) return `${name} ${num(lo)}–${num(hi)}${u}`
    if (lo != null) return `${name} ≥ ${num(lo)}${u}`
    return `${name} ≤ ${num(hi!)}${u}`
  }
  const opt = facet.options.find((o) => o.value === value)
  if (!opt) return `${name}: ${value}`
  // `placeNames` (cover areas, "Can teach in"): a place is its own English or Vietnamese name, never machine-translated.
  const optLabel = facetOptionLabel(facet, opt, lang, tr)
  // An option that states its own count AND unit ("2 BR", "4 seats") is already the whole chip.
  if (/^\d/.test(optLabel) && /\p{L}/u.test(optLabel)) return optLabel
  // A one-option toggle named like its facet ("In Vietnam now", 2026-10-08) is the whole chip too — never
  // "In Vietnam now: In Vietnam now".
  return optLabel === name ? optLabel : `${name}: ${optLabel}`
}
