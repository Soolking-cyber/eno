/**
 * Validation for scripts/import-schools.ts, kept free of the database and of `.env` so a test can run it over
 * the real data/schools/hcmc.json. The script does the I/O; everything that decides whether an entry is
 * acceptable lives here.
 */
import { fold } from '@/lib/fold'
import { findBannedWord } from '@/lib/publish-guard'
import { containsPhoneNumber } from '@/lib/phone'
import { isHcmcArea, isSchoolKind, type SchoolKind } from '@/lib/schools/constants'
import { isGenericEmployer, normEmployer } from '@/lib/schools/logic'

export type Entry = {
  slug?: string; name: string; kind: string; website?: string | null; districts?: string[]; curricula?: string[]
  summary?: string; summaryVi?: string | null; aliases?: string[]; sourceUrls?: string[]
}

export function slugify(name: string): string {
  return fold(name).replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '')
}

// `undefined` = the file does not say: kept as it is on an existing school, defaulted on a new one.
// `null` in the file CLEARS: a summary becomes '' (the column is not nullable), a Vietnamese summary null.
export type Clean = { slug: string; name: string; kind: SchoolKind; website: string | null | undefined; districts: string[] | undefined; curricula: string[] | undefined; summary: string | undefined; summaryVi: string | null | undefined; aliases: string[]; sourceUrls: string[] | undefined }

/** Validate one entry. Returns the cleaned row or the reasons it was refused. */
export function clean(e: Entry): { ok: true; row: Clean } | { ok: false; why: string[] } {
  const why: string[] = []
  // Untrusted JSON: a wrong TYPE is a refusal with a reason, never a crash half-way through the file.
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return { ok: false, why: ['entry is not an object'] }
  for (const k of ['name', 'kind', 'slug', 'website', 'summary', 'summaryVi'] as const) {
    const v = (e as Record<string, unknown>)[k]
    if (v !== undefined && v !== null && typeof v !== 'string') return { ok: false, why: [`${k} is not a string`] }
  }
  const name = (e.name ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 120) why.push('name length')
  if (!isSchoolKind(e.kind)) why.push(`kind "${e.kind}"`)
  const slug = (e.slug ?? slugify(name)).trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) why.push(`slug "${slug}"`)
  let website: string | null | undefined = e.website === undefined ? undefined : null
  if (e.website) {
    try {
      const u = new URL(e.website)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') why.push('website protocol')
      else website = u.toString()
    } catch { why.push('website url') }
  }
  const summary = e.summary === undefined ? undefined : (e.summary ?? '').trim()
  const summaryVi = e.summaryVi === undefined ? undefined : (e.summaryVi ?? '').trim() || null
  if ((summary ?? '').length > 600) why.push('summary > 600 chars')
  for (const t of [name, summary ?? '', e.summaryVi ?? '']) {
    if (findBannedWord(t)) why.push(`banned word in "${t.slice(0, 40)}"`)
    if (containsPhoneNumber(t)) why.push(`phone number in "${t.slice(0, 40)}"`)
  }
  // STRICT: a present field must be an array of strings within its limit — refused, never coerced or cut.
  // An ABSENT field is `undefined`: an existing school keeps what it has (only what the file says changes).
  const list = (field: string, xs: unknown, max: number): string[] | undefined => {
    if (xs === undefined || xs === null) return undefined
    if (!Array.isArray(xs) || xs.some((x) => typeof x !== 'string')) { why.push(`${field} is not a list of strings`); return [] }
    const out = [...new Set(xs.map((x: string) => x.trim()).filter(Boolean))]
    if (out.length > max) why.push(`${field} has ${out.length} entries (max ${max})`)
    return out
  }
  const sourceUrls = list('sourceUrls', e.sourceUrls, 10)
  for (const u of sourceUrls ?? []) { try { const p = new URL(u).protocol; if (p !== 'https:' && p !== 'http:') why.push(`sourceUrl "${u}"`) } catch { why.push(`sourceUrl "${u}"`) } }
  const rawAliases = list('aliases', e.aliases, 20) ?? []
  for (const a of rawAliases) {
    if (a.length > 120) why.push(`alias longer than 120 chars "${a.slice(0, 40)}…"`)
    if (findBannedWord(a)) why.push(`banned word in alias "${a.slice(0, 40)}"`)
    if (containsPhoneNumber(a)) why.push(`phone number in alias "${a.slice(0, 40)}"`)
  }
  // ⛔ A generic phrase is never an alias (logic.ts isGenericEmployer) — not even the school's own name.
  const aliases = [...new Set([name, ...rawAliases].map(normEmployer).filter((a) => !isGenericEmployer(a)))]
  const districts = list('districts', e.districts, 30)
  // An area outside HCMC_AREAS is never offered as a filter, so the school could not be found by area.
  for (const d of districts ?? []) if (!isHcmcArea(d)) why.push(`district "${d}" is not in HCMC_AREAS`)
  const curricula = list('curricula', e.curricula, 10)
  if (why.length) return { ok: false, why }
  return {
    ok: true,
    row: {
      slug, name, kind: e.kind as SchoolKind, website, districts, curricula,
      // undefined = the file says nothing: an existing Vietnamese summary is KEPT, never nulled.
      summary, summaryVi, aliases, sourceUrls,
    },
  }
}

/**
 * The whole file: its shape, every entry, and duplicates INSIDE it (a data error, never resolved by order).
 * Throws on a wrong shape or a duplicate; a bad entry is listed in `refused`. Exported so a test runs it on the
 * real data/schools/hcmc.json.
 */
export function readEntries(raw: unknown): { rows: Clean[]; refused: { at: number; name: string; why: string[] }[] } {
  const entries = (raw as { schools?: unknown } | null)?.schools
  if (!Array.isArray(entries)) throw new Error('the file must be { "schools": [ … ] } — nothing was written')
  const rows: Clean[] = []
  const refused: { at: number; name: string; why: string[] }[] = []
  for (const [i, e] of (entries as Entry[]).entries()) {
    const c = clean(e)
    if (c.ok) rows.push(c.row)
    else refused.push({ at: i, name: typeof e?.name === 'string' ? e.name : '', why: c.why })
  }
  const seenSlug = new Map<string, string>(), seenAlias = new Map<string, string>()
  for (const r of rows) {
    if (seenSlug.has(r.slug)) throw new Error(`duplicate slug "${r.slug}": ${seenSlug.get(r.slug)} / ${r.name}`)
    seenSlug.set(r.slug, r.name)
    for (const a of r.aliases) {
      if (seenAlias.has(a) && seenAlias.get(a) !== r.slug) throw new Error(`alias "${a}" claimed by both ${seenAlias.get(a)} and ${r.slug} — give one of them a more specific alias`)
      seenAlias.set(a, r.slug)
    }
  }
  return { rows, refused }
}
