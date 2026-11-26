import { SITE_NAME } from '@/lib/edition'
import { formatInteger } from '@/lib/vnd'
/** What a shop's About block (shop-about.tsx) says: one listing or many, whether categories are named, and each language's values
 *  under one placeholder set (<Bilingual valuesVi>). */
export type StorefrontIntro = { one: boolean; withCats: boolean; values: Record<string, string>; valuesVi: Record<string, string> }

/**
 * The shop's facts: "<Name> has <n> listings on <site>, including <top categories>." From the grid's own rows (the two most
 * common categories among those loaded) and the shop's live count; null without a listing. Count grouped per language.
 */
export function storefrontIntro(
  name: string,
  total: number,
  rows: readonly { category?: { name: string; nameVi?: string | null } | null }[],
): StorefrontIntro | null {
  if (total < 1 || !name.trim()) return null
  const tally = new Map<string, { en: string; vi: string; n: number }>()
  for (const r of rows) {
    if (!r.category?.name) continue
    const t = tally.get(r.category.name) ?? { en: r.category.name, vi: r.category.nameVi || r.category.name, n: 0 }
    t.n++
    tally.set(r.category.name, t)
  }
  const top = [...tally.values()].sort((a, b) => b.n - a.n).slice(0, 2)
  return {
    one: total === 1,
    withCats: top.length > 0,
    values: { name, site: SITE_NAME, n: formatInteger(total, 'en'), cats: top.map((t) => t.en).join(' and ') },
    valuesVi: { name, site: SITE_NAME, n: formatInteger(total, 'vi'), cats: top.map((t) => t.vi).join(' và ') },
  }
}
