'use client'

// ── "WHICH PROVINCE?" (teacher onboarding redesign, 2026-10-08) ──────────────────────────────────────────────────────
// For a teacher who answered "Somewhere else in Vietnam": the 27 provinces no city chip covers whole
// (places.ts PROVINCE_PLACES), searchable by their Vietnamese and English names — and by the TOWNS people type that are
// neither (places.ts TOWN_ALIASES, facts of the 2025 merger): "Quy Nhơn" finds Gia Lai, "Hội An" finds Da Nang.
// ⛔ A TOWN ALIAS THAT POINTS AT A CITY CHIP SWITCHES THE ANSWER to that chip ("Hội An" → the Da Nang chip, "Biên Hòa"
// → Dong Nai / Bien Hoa): the caller gets the alias's TARGET key — a hub or a province key — never the town.
// The closed-list rules (typing only filters, Enter commits only a row the person moved to, only Clear clears) are
// closed-combobox.tsx's.

import { useCallback, useMemo } from 'react'
import { useLanguage } from '@/context/language-context'
import { ClosedCombobox, matchesStarts, startsOf } from '@/components/teachers/closed-combobox'
import { PROVINCE_PLACES, TOWN_ALIASES, placeLabel } from '@/lib/teachers/places'

const ALIAS = 'alias:'
const aliasAt = (key: string) => (key.startsWith(ALIAS) ? TOWN_ALIASES[Number(key.slice(ALIAS.length))] : undefined)

export function ProvinceCombobox({ id, value, onPick }: {
  id?: string
  /** The chosen province KEY ('p-52'), or '' for none. */
  value: string
  /** A province key, or — for a town alias pointing at a city chip — that hub's key. */
  onPick: (placeKey: string) => void
}) {
  const { tr, lang } = useLanguage()
  const { items, starts } = useMemo(() => {
    const byName = new Intl.Collator(lang).compare
    const provinces = PROVINCE_PLACES.map((p) => p.key).sort((a, b) => byName(placeLabel(a, lang), placeLabel(b, lang)))
    const towns = TOWN_ALIASES.map((_, i) => `${ALIAS}${i}`)
    const s: Record<string, readonly string[]> = {}
    for (const p of PROVINCE_PLACES) s[p.key] = startsOf([p.name, p.nameEn])
    TOWN_ALIASES.forEach((a, i) => { s[`${ALIAS}${i}`] = startsOf([a.name, a.nameEn]) })
    return { items: [...provinces, ...towns], starts: s }
  }, [lang])
  const labelOf = useCallback((key: string) => {
    const a = aliasAt(key)
    // A place name, never machine-translated (PlaceName's rule): the town as people write it, then where it is.
    return a ? `${lang === 'vi' ? a.name : a.nameEn} → ${placeLabel(a.to, lang)}` : placeLabel(key, lang)
  }, [lang])
  const matches = useCallback((key: string, query: string) => matchesStarts(starts[key], query), [starts])
  return (
    <ClosedCombobox
      id={id}
      items={items}
      value={value}
      onChange={(key) => onPick(aliasAt(key)?.to ?? key)}
      labelOf={labelOf}
      matches={matches}
      placeholder={tr('Type your province or town', 'Nhập tỉnh hoặc thị xã của bạn')}
      emptyText={tr('No province or town matches.', 'Không có tỉnh hoặc thị xã phù hợp.')}
      clearLabel={tr('Clear province', 'Xoá tỉnh')}
      triggerLabel={tr('Open the province list', 'Mở danh sách tỉnh')}
    />
  )
}
