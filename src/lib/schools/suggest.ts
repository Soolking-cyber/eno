/**
 * "Suggest a school" (owner, 2026-10-05: "add a place for teachers to add new schools"). Plan:
 * ~/.claude/plans/eno-schools-v2-2026-10-05.md §C. Pure — the route (/api/schools/suggest) does the I/O.
 *
 * A suggestion is never a school by itself: a moderator adds it (admin → Suggestions), and the row it becomes
 * passes the SAME validation as data/schools/hcmc.json (import-entries.ts clean()), aliases included — the
 * aliases are how job ads find their school, so a suggested name that is only a generic phrase is refused.
 */
import { containsPhoneNumber } from '@/lib/phone'
import { findBannedWord } from '@/lib/publish-guard'
import { SUGGESTION_NOTE_MAX, isHcmcArea } from './constants'
import { clean, type Clean } from './import-entries'
import { isGenericEmployer, normEmployer } from './logic'

export { SUGGESTION_NOTE_MAX, SUGGESTIONS_PENDING_MAX } from './constants'

/**
 * Hosts many schools share — a Facebook page, a site builder: a match on one says nothing about whether two
 * schools are the same, so they are never compared.
 */
const SHARED_HOSTS = ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'linkedin.com', 'tiktok.com', 'youtube.com', 'zalo.me', 'google.com', 'goo.gl', 'linktr.ee', 'wixsite.com', 'blogspot.com', 'wordpress.com', 'weebly.com', 'business.site', 'canva.site', 'notion.site']

/** A website's host for matching (lower-case, no `www.`), or null when there is none or it is a shared one. */
export function websiteKey(url: string | null | undefined): string | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  if (!host.includes('.') || SHARED_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return null
  return host
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i

export type SuggestionInput = { name: string; kind: string; website?: string | null; districts?: string[]; note?: string }
export type SuggestionRefusal = 'school_name_invalid' | 'website_invalid' | 'district_invalid' | 'contact_in_text' | 'banned_words'
export type CheckedSuggestion = { row: Clean; nameKey: string; host: string | null; note: string }

/**
 * A teacher's suggestion → the row a moderator would add, or the one reason it is refused. Contact details
 * are refused in the name and the note (a suggestion is not an advert), as on every other user text.
 */
export function checkSuggestion(input: SuggestionInput): { ok: true; value: CheckedSuggestion } | { ok: false; code: SuggestionRefusal } {
  const note = (input.note ?? '').trim().replace(/\s+/g, ' ').slice(0, SUGGESTION_NOTE_MAX)
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ')
  for (const t of [name, note]) {
    if (containsPhoneNumber(t) || EMAIL.test(t)) return { ok: false, code: 'contact_in_text' }
    if (findBannedWord(t)) return { ok: false, code: 'banned_words' }
  }
  for (const d of input.districts ?? []) if (!isHcmcArea(d)) return { ok: false, code: 'district_invalid' }
  const website = (input.website ?? '').trim()
  if (website) {
    let u: URL | null = null
    try { u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`) } catch { u = null }
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname.includes('.')) return { ok: false, code: 'website_invalid' }
  }
  const c = clean({ name, kind: input.kind, website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null, districts: input.districts ?? [], summary: '' })
  if (!c.ok) return { ok: false, code: c.why.some((w) => w.startsWith('website')) ? 'website_invalid' : c.why.some((w) => w.startsWith('district')) ? 'district_invalid' : 'school_name_invalid' }
  const nameKey = normEmployer(c.row.name)
  // ⛔ A generic phrase is no school's name: it would match every job ad that says "English centre".
  if (isGenericEmployer(nameKey) || c.row.aliases.length === 0) return { ok: false, code: 'school_name_invalid' }
  return { ok: true, value: { row: c.row, nameKey, host: websiteKey(c.row.website), note } }
}
