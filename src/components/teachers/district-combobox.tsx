'use client'

// ── "WHICH DISTRICT DO YOU LIVE IN?" (HCMC only, optional — teacher onboarding redesign, 2026-10-08) ──────────────────
// The 24 curated HCMC districts (places.ts HCMC_DISTRICT_KEYS — the explorer's DISTRICTS table, never copied) and
// "Prefer not to say". The district is where the teacher LIVES (Listing.district, the Area filter); where they can
// TEACH is the Where step's list. Searchable by the Vietnamese and English names and the neighbourhood names people use
// ("Thảo Điền", "Phú Mỹ Hưng"). The closed-list rules are closed-combobox.tsx's.
// "Prefer not to say" stores nothing (currentDistrictKey ''), exactly like leaving it empty — the row exists so the
// question can be answered without a district, and the field then says so instead of looking unanswered.
// ⛔ THIS FIELD HOLDS NO STATE (gate review, 2026-10-08): it is a plain closed list whose rows are the districts and
// DISTRICT_NOT_SAYING, and it reports the ROW picked. Whether "Prefer not to say" was answered is the FORM's to keep
// (teacher-form.tsx, which also turns the row into the stored '') — a field remounts with its step, and the answer it
// kept for itself showed as unanswered after a step change, a reload or the Google round trip.

import { useCallback, useMemo } from 'react'
import { useLanguage } from '@/context/language-context'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { ClosedCombobox, matchesStarts, startsOf } from '@/components/teachers/closed-combobox'
import { HCMC_DISTRICT_KEYS, placeLabel } from '@/lib/teachers/places'

/** The "Prefer not to say" row — never a stored value (the form stores '' for it). */
export const DISTRICT_NOT_SAYING = 'prefer-not-to-say'

export function DistrictCombobox({ id, value, onChange }: {
  id?: string
  /** A HCMC district key, DISTRICT_NOT_SAYING (answered without one), or '' (not answered). */
  value: string
  /** The row picked — a district key or DISTRICT_NOT_SAYING — or '' when the field is cleared. */
  onChange: (row: string) => void
}) {
  const { tr, lang } = useLanguage()
  const starts = useMemo(() => {
    const s: Record<string, readonly string[]> = {}
    for (const d of DISTRICTS) if (d.slug !== 'all') s[d.slug] = startsOf([d.name, d.nameEn, ...(d.match ?? [])])
    return s
  }, [])
  const items = useMemo(() => [DISTRICT_NOT_SAYING, ...HCMC_DISTRICT_KEYS], [])
  const notSayingLabel = tr('Prefer not to say', 'Không muốn trả lời')
  const labelOf = useCallback((key: string) => (key === DISTRICT_NOT_SAYING ? notSayingLabel : placeLabel(key, lang)), [lang, notSayingLabel])
  const matches = useCallback((key: string, query: string) => (key === DISTRICT_NOT_SAYING ? true : matchesStarts(starts[key], query)), [starts])
  return (
    <ClosedCombobox
      id={id}
      items={items}
      value={value}
      onChange={onChange}
      labelOf={labelOf}
      matches={matches}
      placeholder={tr('Type or choose a district', 'Nhập hoặc chọn quận')}
      emptyText={tr('No district matches.', 'Không có quận phù hợp.')}
      clearLabel={tr('Clear district', 'Xoá quận')}
      triggerLabel={tr('Open the district list', 'Mở danh sách quận')}
    />
  )
}
