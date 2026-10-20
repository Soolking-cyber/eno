/**
 * THE MESSAGE — owner's words, 2026-10-20: "Hi this is Alex from eno.vn, we've found these jobs that match your profile try
 * to apply for those and best of luck". English only (owner, same day: "no need for vietnamese version"). Pure.
 *
 * ⛔ eno'S OWN WORDS ONLY. A post is never quoted: each job is a line built from the facts that were read (kind, ages,
 * place, day, pay, what it asks for) plus its link — so nothing a poster wrote (a phone number, an insult, a visa
 * promise) can reach a teacher through eno's account. The one exception is a forwarded post's "Apply:" line, which an
 * eno team member wrote and is screened like everything else.
 * ⛔ NO VISA WORDING on eno.vn (licensing split): the composed text must pass isVisaWorded; a group or job title that
 * carries a visa word is replaced or the job is left out (composeDm returns the skipped keys).
 * ⛔ DISCLOSED AUTOMATION: every message says the jobs were matched automatically, how to stop them, and never to pay a fee.
 */
import { compactVnd, formatMoneyFull } from '@/lib/vnd'
import { fold } from '@/lib/fold'
import { maskContacts } from './ingest'
import { isVisaWorded } from '@/lib/teachers/match-emails'
import { HCMC, placeLabel } from '@/lib/teachers/places'
import type { Employment, Pay, RuleFacts } from './extract'
import { specificPlaces } from './gates'

export type DmItem = {
  key: string
  title: string
  when?: string
  pay?: string
  asks: string[]
  source: string
  link?: string
  apply?: string
}

const KIND_LABEL: Record<Employment, string> = {
  cover: 'Cover lesson',
  full_time: 'Full-time teaching job',
  part_time: 'Part-time teaching job',
  private: 'Private tutoring',
  online: 'Online teaching job',
}
const AGE_LABEL: Record<string, string> = { kids: 'kids', teens: 'teens', adults: 'adults' }
const SUBJECT_LABEL: Record<string, string> = {
  ielts: 'IELTS', 'toefl-toeic': 'TOEIC/TOEFL', cambridge: 'Cambridge', phonics: 'phonics', 'business-english': 'Business English', stem: 'STEM',
}

/** "Binh Thanh, Ho Chi Minh City" / "Hanoi" / "Online" — from the curated place labels, English. */
export function placeText(places: readonly string[]): string {
  const specific = specificPlaces(places)
  if (!specific.length) return places.includes('online') ? 'Online' : ''
  const names = specific.slice(0, 2).map((k) => placeLabel(k, 'en'))
  const inHcmc = specific.every((k) => k !== HCMC) && places.includes(HCMC)
  return `${names.join(' / ')}${inHcmc ? ', Ho Chi Minh City' : ''}${places.includes('online') ? ' (or online)' : ''}`
}

/** One figure without its "đ" — vnd.ts's: "25M" from a million up (compactVnd), "400,000" below (formatMoneyFull). */
function money(n: number): string {
  return (n >= 1_000_000 ? compactVnd(n, 'en') : formatMoneyFull(n, '₫', 'en')).replace(/ đ$/, '')
}

/** "400,000 đ / hour", "25M–30M đ / month" — the figure as read, in vnd.ts's English forms. */
export function payText(p: Pay | null): string | undefined {
  if (!p) return undefined
  const unit = p.unit === 'hour' ? 'hour' : p.unit === 'session' ? 'class' : p.unit === 'day' ? 'day' : p.unit === 'month' ? 'month' : ''
  if (!unit) return undefined
  const range = p.min === p.max ? money(p.max) : `${money(p.min)}–${money(p.max)}`
  return `${range} đ / ${unit}`
}

/** What the post asks for, as the message will say it. */
export function asksOf(f: Pick<RuleFacts, 'requirements'>): string[] {
  const r = f.requirements
  const out: string[] = []
  if (r.degree === 'required') out.push('a degree')
  // gates.ts counts a PGCE or a teaching licence too (codex, gate 2d) — the words say so.
  if (r.tefl === 'required') out.push('a teaching certificate (TEFL/TESOL/CELTA or similar)')
  if (r.minYears) out.push(`${r.minYears}+ years' experience`)
  if (r.native === 'required') out.push('native English speakers')
  return out
}

/** The job's line title in eno's words: "Cover lesson · kids · phonics — Binh Thanh, Ho Chi Minh City". */
export function titleOf(f: Pick<RuleFacts, 'kind' | 'employment' | 'ageGroups' | 'subjects' | 'places'>): string {
  const kind = f.kind === 'cover_request' ? 'cover' : (['full_time', 'part_time', 'private', 'online'] as const).find((e) => f.employment.includes(e))
  const head = kind ? KIND_LABEL[kind] : 'Teaching job'
  const bits = [head, ...f.ageGroups.map((a) => AGE_LABEL[a]).filter(Boolean), ...f.subjects.map((s) => SUBJECT_LABEL[s]).filter(Boolean)].slice(0, 4)
  const where = placeText(f.places)
  return `${bits.join(' · ')}${where ? ` — ${where}` : ''}`
}

/**
 * A source line in eno's words. A group's NAME is the one poster-chosen string that could reach a teacher (codex + opus,
 * gate 2b: "Việc làm GV — Zalo 0901234567") — it is used only when it is plainly a name: letters, digits, spaces and
 * light punctuation, ≤ 60 characters, no contact, no link, no visa word, no long digit run. Anything else reads as
 * "a Facebook teaching-jobs group".
 */
export function sourceLine(source: 'fb' | 'linkedin' | 'intake' | 'eno', name?: string | null): string {
  if (source === 'linkedin') return 'Posted on LinkedIn'
  if (source === 'eno') return 'Listed on eno.vn'
  if (source === 'intake') return 'Shared with us by the eno.vn team'
  const n = (name || '').replace(/\s+/g, ' ').trim()
  const plain = n.length > 0 && n.length <= 60 && /^[\p{L}\p{M}\p{N} &'’().,:|/+–-]+$/u.test(n) && maskContacts(n) === n
    && !/\d{5,}|https?:|www\.|\.(com|vn|net|me)\b|@/i.test(n) && !isVisaWorded(n) && !VISA_SLUG.test(fold(n).replace(/[^a-z0-9]+/g, ''))
  return plain ? `Posted in the Facebook group "${n}"` : 'Posted in a Facebook teaching-jobs group'
}
/** Visa and permit words run together, as a link slug or a squashed name has them (opus, gate 2b: /groups/workpermitteachersvn/). */
const VISA_SLUG = /visa|thithuc|workpermit|giayphep|laodong|tamtru|residencecard|residence|immigration|xuatnhapcanh/

const MAX_LEN = 1900

/**
 * The whole message. `first` = the first jobs-desk message this teacher ever gets: it says once who Alex is and why
 * the teacher gets these. Returns the text and the keys left out (visa wording, or the length cap).
 */
export function composeDm(a: { firstName: string | null; items: readonly DmItem[]; kind: 'jobs' | 'cover'; first: boolean }): { text: string; included: string[]; skipped: string[] } {
  const name = (a.firstName || '').split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 30)
  const hello = `Hi${name ? ` ${name}` : ''}, this is Alex from eno.vn.`
  const intro = a.first
    ? ' You switched on job messages on eno.vn, so we send you jobs and cover lessons that fit your teacher profile.'
    : ''
  const leadFor = (count: number) => a.kind === 'cover'
    ? `We've found ${count === 1 ? 'a cover lesson that matches' : 'cover lessons that match'} your free periods and areas:`
    : `We've found ${count === 1 ? 'a job that matches' : 'these jobs that match'} your profile:`
  const outroFor = (count: number) => [
    count === 1 ? 'Try applying — best of luck!' : 'Try applying for those — best of luck!',
    'Never pay a fee to get a job.',
    '',
    'Matched automatically from your eno.vn profile. Reply STOP to stop these messages.',
  ].join('\n')
  const render = (blocks: readonly string[]) => [hello + intro, '', leadFor(blocks.length), '', blocks.join('\n\n'), '', outroFor(blocks.length)].join('\n')

  const included: string[] = []
  const skipped: string[] = []
  const blocks: string[] = []
  for (const it of a.items) {
    const lines = [`${blocks.length + 1}. ${it.title}`]
    const meta = [it.when, it.pay].filter(Boolean).join(' · ')
    if (meta) lines.push(`   ${meta}`)
    if (it.asks.length) lines.push(`   The post asks for ${joinAnd(it.asks)}.`)
    lines.push(`   ${it.source}`)
    if (it.apply) lines.push(`   How to apply: ${it.apply.replace(/[\r\n]+/g, ' ').slice(0, 200)}`)
    if (it.link) lines.push(`   ${it.link}`)
    const block = lines.join('\n')
    // A link is checked whole too: a group slug like /groups/vietnamvisateachers/ is a visa word inside a word (opus, gates 2a + 2b).
    const linkVisa = !!it.link && VISA_SLUG.test(fold(it.link).replace(/[^a-z0-9]+/g, ''))
    if (linkVisa || isVisaWorded(block) || render([...blocks, block]).length > MAX_LEN) { skipped.push(it.key); continue }
    blocks.push(block)
    included.push(it.key)
  }
  if (!blocks.length) return { text: '', included: [], skipped }
  const text = render(blocks)
  // Belt and braces: the greeting carries the teacher's own name — if anything in the whole still reads as visa wording,
  // nothing is sent rather than a message eno.vn may not carry.
  if (isVisaWorded(text)) return { text: '', included: [], skipped: [...skipped, ...included] }
  return { text, included, skipped }
}

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}
