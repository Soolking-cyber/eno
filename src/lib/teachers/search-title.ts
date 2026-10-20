/**
 * THE TEACHER PROFILE'S <title> LINE (SEO plan P1 item 14, owner 2026-10-20) — "IELTS & English teacher, Ho Chi Minh City",
 * what a search result shows after the name: what they teach and where they live, built ONLY from fields the page itself
 * shows (the Subjects row and its taught languages, the "Lives in" line), so a result never says more than the page.
 * ⛔ A FIELD THE PROFILE LACKS IS LEFT OUT, NEVER GUESSED: no subject → "Teacher"; a teacher abroad or one who has not
 * said where they live → no place (never "Vietnam", never the old Hồ Chí Minh fallback — profile-view.ts). The PDP's
 * generateMetadata wraps it as "<Name> — <line> | <site>".
 *
 * At most TWO subjects, so the line stays inside a result's width: the first specialism (the taxonomy's order, the order
 * the page lists them), then "English" when they teach General English — the plan's own example — or else the next
 * specialism. Business English already says English, so it is not followed by it.
 * ⚠️ Title words, not the chips' labels: "English" for General English and "STEM" for the "Maths & science" chip read
 * before "teacher" ("Maths & science & English teacher" does not). "Other language" is the languages the teacher typed,
 * as the page prints them — except that a Vietnamese title names a common language the Vietnamese way ("tiếng Hàn", never
 * "Giáo viên Korean"); a language not in LANGUAGE_VI stays as typed. ⚠️ TUPLES, NOT `{ en, vi }` PAIRS: scripts/gen-ui-strings.mjs harvests those into the
 * client's translation catalogue, and these words only ever reach a server-rendered <title>.
 */
import { homeLocationName, publicSituation } from '@/lib/teachers/profile-view'

/** [English, Vietnamese] — the word a title uses for each subject the form offers ('other-language' is the taught languages). */
const TITLE_SUBJECT: Readonly<Record<string, readonly [string, string]>> = {
  'general-english': ['English', 'tiếng Anh'],
  ielts: ['IELTS', 'IELTS'],
  'toefl-toeic': ['TOEFL/TOEIC', 'TOEFL/TOEIC'],
  cambridge: ['Cambridge', 'Cambridge'],
  phonics: ['Phonics', 'Phonics'],
  'business-english': ['Business English', 'tiếng Anh thương mại'],
  stem: ['STEM', 'STEM'],
}

/** A typed language name (folded to lower case) → its Vietnamese title word. Only names a teacher plausibly types in English. */
const LANGUAGE_VI: Readonly<Record<string, string>> = {
  english: 'tiếng Anh', korean: 'tiếng Hàn', japanese: 'tiếng Nhật', chinese: 'tiếng Trung', mandarin: 'tiếng Trung',
  cantonese: 'tiếng Quảng Đông', french: 'tiếng Pháp', german: 'tiếng Đức', spanish: 'tiếng Tây Ban Nha', italian: 'tiếng Ý',
  portuguese: 'tiếng Bồ Đào Nha', russian: 'tiếng Nga', thai: 'tiếng Thái', vietnamese: 'tiếng Việt', arabic: 'tiếng Ả Rập',
  hindi: 'tiếng Hindi', indonesian: 'tiếng Indonesia', dutch: 'tiếng Hà Lan', filipino: 'tiếng Philippines', tagalog: 'tiếng Tagalog',
}

export type TeacherTitleFields = {
  subjects?: readonly string[] | null
  teachLanguages?: readonly string[] | null
  livesIn?: string | null
  currentCity?: string | null
  currentDistrictKey?: string | null
  currentProvince?: string | null
  teachAreas?: readonly string[] | null
}

/** The title words for what this teacher teaches — at most two (see the header); [] for none. */
export function titleSubjects(t: Pick<TeacherTitleFields, 'subjects' | 'teachLanguages'>, lang: string): string[] {
  const at = lang === 'vi' ? 1 : 0
  const subjects = t.subjects ?? []
  const specialisms: { key: string; name: string }[] = []
  for (const s of subjects) {
    if (s === 'general-english') continue
    if (s === 'other-language') {
      for (const l of t.teachLanguages ?? []) {
        const name = l.trim()
        if (name) specialisms.push({ key: s, name: (at === 1 && LANGUAGE_VI[name.toLowerCase()]) || name })
      }
    } else if (Object.hasOwn(TITLE_SUBJECT, s)) specialisms.push({ key: s, name: TITLE_SUBJECT[s][at] })
  }
  const picks = specialisms.slice(0, 1).map((x) => x.name)
  if (subjects.includes('general-english') && specialisms[0]?.key !== 'business-english') picks.push(TITLE_SUBJECT['general-english'][at])
  else if (specialisms[1]) picks.push(specialisms[1].name)
  return picks
}

/**
 * "IELTS & English teacher, Ho Chi Minh City" / "Giáo viên IELTS và tiếng Anh tại TP. Hồ Chí Minh" — the place is the
 * city (or the province) the teacher lives in, in the page's language (places.ts, never machine-translated).
 */
export function teacherTitleLine(t: TeacherTitleFields, lang: string): string {
  const vi = lang === 'vi'
  const names = titleSubjects(t, lang)
  const place = homeLocationName(publicSituation(t), vi ? 'vi' : 'en')
  if (vi) return `Giáo viên${names.length ? ` ${names.join(' và ')}` : ''}${place ? ` tại ${place}` : ''}`
  return `${names.length ? `${names.join(' & ')} teacher` : 'Teacher'}${place ? `, ${place}` : ''}`
}
