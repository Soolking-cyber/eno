/**
 * "IMPROVE WITH AI" FOR A TEACHER'S ABOUT TEXT (owner, 2026-10-21: "add ai enhancement once they write about them … it
 * should read all teacher info that was inputed and description they have and enhance it in short concise but very
 * effective form") — the two PURE halves of the rewrite, so vitest pins them and the route stays thin
 * (src/app/api/teachers/me/bio-rewrite; the model call is bio-ai.ts):
 *   · teacherBioRequest(raw) — the form's CURRENT answers (a new teacher has only a draft, so the route reads the body,
 *     never a row) as the model will see them: normalised exactly as a save keeps them (normalizeForSave — an answer
 *     the save would drop is never sent), then read FIELD BY FIELD into short English "Label: value" lines.
 *   · acceptTeacherBio(text, req) — the model's answer as a bio Publish accepts, or the reason it is not one.
 *
 * ⛔ WHAT NEVER LEAVES eno.vn HERE (the notice beside the button names the rest — bio-notice.ts): the name, the phone,
 * the email (TeacherInput has none), the photo, the video, the CV (TeacherPrivate — never read here), the expected
 * salary, the start month and the cover lessons (they change, and the page shows them in their own rows — prose would
 * go stale: the bio is stored as typed), every consent and opt-in. Free texts are read one by one, never spread.
 * ⛔ THE TEACHER'S OWN TEXT GOES AS WRITTEN — minus any sentence with contact details (an email, a link, a handle, a
 * messenger id, a phone-length run of digits): those have no place in a bio and Google does not need them. NOT the
 * matcher's stripNameWords (match-io.ts), measured 2026-10-21 to corrupt Vietnamese — a teacher named Nam loses every
 * "năm" (year), Anh loses "tiếng Anh", Long loses "long-term". And NOT Publish's whole screen on the way in: its phone
 * reader takes "từ năm 2016, năm 2019" for a number ("năm" is also five), and the sentence a Vietnamese teacher's
 * experience lives in would be lost before the model saw it. The ANSWER gets the whole screen (acceptTeacherBio).
 *
 * ⚠️ THE GROUNDING CHECK IS A BACKSTOP, NOT THE GUARANTEE (plan review, codex + opus 2026-10-21): it can test what is
 * checkable in text — every number, the certificates and exams by name, a degree, "native speaker", "certified" — and
 * nothing else; an invented method or result in plain words passes it. The instruction (bio-ai.ts) and the real-model
 * eval (~/eno-cvai-work.noindex/eval) carry the rest, and the teacher reads the text before anything is published.
 */
import { decodeEntities } from '@/lib/feed-text'
import { containsContactInfo } from '@/lib/publish-guard'
import { stripMarkdown } from '@/lib/strip-md'
import { storedLanguageLabel } from '@/components/teachers/language-list'
import { countryName } from '@/lib/teachers/countries'
import { publishableBio } from '@/lib/teachers/import-map'
import { placeLabel } from '@/lib/teachers/places'
import { livesInLine, publicSituation, teachAreaRows } from '@/lib/teachers/profile-view'
import { LIMITS, TEACHER_OPTIONS, normalizeForSave, normalizeTeacherInput, type TeacherInput } from '@/lib/teachers/profile'
import { ABOUT_WORDS_FLOOR, wordCount } from '@/lib/teachers/search-floor'

/** The teacher's own text the button needs (trimmed) — the post wizard's Polish floor; the route answers too_short below. */
export const BIO_OWN_TEXT_MIN = 3
/** An answer past this is not "short and concise" (the instruction asks 60–120 words): asked again, never cut. */
export const BIO_MAX_WORDS = 200

export type TeacherBioRequest = {
  /** The data block's lines: English labels, the teacher's values. */
  facts: string[]
  /** The teacher's own About text as written, minus the sentences with contact details ('' when nothing is left). */
  ownBio: string
  /** What a claim in the answer may rest on (acceptTeacherBio). */
  grounds: BioGrounds
}

type BioGrounds = {
  /** Every fact and the teacher's own text, lower case — what a certificate or exam named in the answer must appear in. */
  text: string
  /** Every number the input states, as canonical strings ("8.0" → "8"), with the number words of the teacher's own text. */
  numbers: ReadonlySet<string>
  /** "Native speaker" is the teacher's to claim: the English answer says native, or their own text makes the claim. */
  native: boolean
  /** A degree is the teacher's to claim: one answered (not "no degree"), or their own text names one. */
  degree: boolean
  /** "Certified" is the teacher's to claim: a certificate answered, or their own text says it. */
  certified: boolean
}

// ── THE REQUEST ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Contact details in a text on its way to the model — an email, a link, a handle, a messenger id (publish-guard's own
 * reader), a run of nine or more digits (a phone number; "2016, 2019" is not one: the comma ends the run) — AND what
 * publish-guard's reader does not know, measured 2026-10-21 (gate review): a domain on .vn, .me, .edu, .co…
 * ("thomasenglish.vn", "thomas-ielts.edu.vn"), a t.me / wa.me / zalo.me link, a messenger named with a handle after a
 * space ("Add me on WhatsApp thomasreed88", "Skype: live:thomas.reed"). ⚠️ ON THE WAY IN ONLY: a false positive costs
 * one sentence the model does not see (a sentence about Facebook groups, say) — Publish's own screen is untouched.
 */
const PHONE_RUN = /(?:\+?\d[ .\-()]*){9,}/
/**
 * A span of years — "2016-2019", "2019 - 2021" — is taken out before PHONE_RUN counts digits (gate review, opus
 * 2026-10-22, measured): beside another number it made nine ("VUS 2016-2019 (3 years)", "IELTS 8.0 (2019 - 2020)",
 * "ages 6-12 (2019-2021)"), so the sentence a teacher's experience lives in never reached the model — and across a
 * sentence end ("…2016-2019. 3 years…") every sentence after it went too (publishableBio's whole-text pass drops from
 * the end). A phone number is never two years joined by a dash.
 */
const YEAR_SPAN = /(?<!\d)(?:19|20)\d{2}\s?[-–—]\s?(?:19|20)\d{2}(?!\d)/g
/**
 * ⚠️ THE ENDING IN LOWER CASE ONLY (gate review, opus 2026-10-22, measured): a missing space after a full stop —
 * "kids.Online classes", "English.Me and my students", common in a second language — is a typo, not a domain; a real one
 * is written in lower case ("thomasenglish.vn", "Thomas-IELTS.edu.vn").
 */
const DOMAIN = /(?<![\p{L}\p{N}@.])[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:vn|me|com|net|org|edu|io|info|co|shop|store|xyz|asia|biz|online|site|page|link|app)(?![\p{L}\p{N}])/u
const SHORT_LINK = /(?<![\p{L}\p{N}])(?:t|wa|zalo|m)\.me\//iu
const MESSENGER = /\b(?:zalo|whats\s?app|telegram|wechat|viber|messenger|facebook|instagram|tiktok|skype|kakao(?:talk)?)\b[\s:@#-]+[a-z0-9._:-]{3,}/i
const contactIn = (text: string) =>
  containsContactInfo(text) || PHONE_RUN.test(text.replace(YEAR_SPAN, 'Y')) || DOMAIN.test(text) || SHORT_LINK.test(text) || MESSENGER.test(text)

const optionLabel = (opts: readonly { value: string; label: string }[], v: string | null | undefined) =>
  (v && opts.find((o) => o.value === v)?.label) || ''

const BAND_WORDS: Readonly<Record<string, string>> = {
  'under-1-year': 'under 1 year', '1-3-years': '1–3 years', '3-5-years': '3–5 years', '5-10-years': '5–10 years', 'over-10-years': 'over 10 years',
}
const ENGLISH_WORDS: Readonly<Record<string, string>> = { native: 'native speaker', fluent: 'fluent', working: 'working level' }
const CERT_WORDS: Readonly<Record<string, string>> = { 'other-cert': 'another teaching certificate', 'teaching-license': 'a teaching licence' }

/** A short free text the teacher typed, or '' when it carries contact details. */
const clean = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t && !contactIn(t) ? t : ''
}
const join = (parts: readonly string[]) => parts.filter(Boolean).join(', ')

/**
 * The form's answers (untrusted — the route's body) as the model's data block. Normalised as a save keeps them, read
 * field by field — never the whole object — and every place, subject, level and certificate as its English label.
 */
export function teacherBioRequest(raw: unknown): TeacherBioRequest {
  const t: TeacherInput = normalizeForSave(normalizeTeacherInput(raw))
  const facts: string[] = []
  const taught = t.teachLanguages.map((n) => clean(storedLanguageLabel(n, 'en'))).filter(Boolean)
  const subjects = t.subjects.flatMap((s) => (s === 'other-language' ? (taught.length ? taught.map((l) => `${l} (as a language)`) : [optionLabel(TEACHER_OPTIONS.subject, s)]) : [optionLabel(TEACHER_OPTIONS.subject, s)]))
  if (subjects.filter(Boolean).length) facts.push(`Subjects: ${join(subjects)}`)
  const ages = t.ageGroups.map((a) => optionLabel(TEACHER_OPTIONS.ageGroup, a))
  if (ages.filter(Boolean).length) facts.push(`Age groups: ${join(ages)}`)
  if (t.experienceBand && BAND_WORDS[t.experienceBand]) facts.push(`Teaching experience: ${BAND_WORDS[t.experienceBand]}`)
  const jobs: TeacherInput['experience'] = []
  for (const x of t.experience) {
    const role = clean(x.role)
    const employer = clean(x.employer)
    if (!role && !employer) continue
    const what = role && employer ? `${role} at ${employer}` : role || employer
    const when = x.from ? (x.to ? `from ${x.from} to ${x.to}` : `from ${x.from} to now`) : ''
    facts.push(`Teaching job: ${join([what, clean(x.city), when])}`)
    jobs.push(x)
  }
  if (t.degreeLevel && t.degreeLevel !== 'no-degree') {
    facts.push(`Degree: ${join([optionLabel(TEACHER_OPTIONS.degree, t.degreeLevel), clean(t.degreeMajor), clean(t.degreeInstitution), t.degreeYear ? String(t.degreeYear) : ''])}`)
  }
  let certificates = 0
  for (const c of t.certificates) {
    const name = CERT_WORDS[c.type] ?? optionLabel(TEACHER_OPTIONS.cert, c.type)
    if (!name) continue
    facts.push(`Certificate: ${join([name, c.hours ? `${c.hours} hours` : '', clean(c.provider), c.year ? String(c.year) : ''])}`)
    certificates++
  }
  if (t.nationality) facts.push(`Nationality: ${countryName(t.nationality, 'en')}`)
  // normalizeForSave keeps it only where it is asked (English-medium subjects).
  if (t.englishLevel && ENGLISH_WORDS[t.englishLevel]) facts.push(`English: ${ENGLISH_WORDS[t.englishLevel]}`)
  const spoken = t.languages.map((n) => clean(storedLanguageLabel(n, 'en')))
  if (spoken.filter(Boolean).length) facts.push(`Other languages spoken: ${join(spoken)}`)
  const situation = publicSituation(t)
  const lives = livesInLine(situation, 'en')
  if (lives?.kind === 'place') facts.push(`Lives in: ${lives.place}`)
  else if (lives?.kind === 'abroad') facts.push('Lives outside Vietnam')
  const rows = teachAreaRows(situation)
  if (rows.canTeachIn.length) facts.push(`Can teach in: ${join(rows.canTeachIn.map((k) => placeLabel(k, 'en')))}`)
  if (rows.wouldMoveTo.length) facts.push(`Would move to: ${join(rows.wouldMoveTo.map((k) => placeLabel(k, 'en')))}`)
  const work = t.jobTypes.map((j) => optionLabel(TEACHER_OPTIONS.jobType, j))
  if (work.filter(Boolean).length) facts.push(`Looking for: ${join(work)}`)
  const headline = clean(t.headline)
  if (headline) facts.push(`Headline: ${headline}`)

  const ownBio = publishableBio(t.bio, contactIn)
  return { facts, ownBio, grounds: groundsOf(t, facts, ownBio, jobs, certificates) }
}

// ── WHAT A CLAIM MAY REST ON ────────────────────────────────────────────────────────────────────────────────────

/**
 * A number as written — a thousands-grouped one first ("2,000", "2.000" — never read as 2: gate review, 2026-10-21), then
 * a plain or decimal one ("8.0", "7,5").
 */
const NUMBER = /(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?![.,]?\d)|\d+(?:[.,]\d+)?/g
const GROUPED = /^\d{1,3}(?:[.,]\d{3})+$/
/** "2,000" / "2.000" → "2000", "8.0" → "8", "7,5" → "7.5", "01" → "1" — one spelling per number. */
const canonical = (n: string) => (GROUPED.test(n) ? String(Number(n.replace(/[.,]/g, ''))) : String(Number.parseFloat(n.replace(',', '.'))))
/** The number words a teacher writes ("two years", "hai năm") — "năm" is also "year", so it lets 5 through: accepted. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, hundred: 100,
  một: 1, hai: 2, ba: 3, bốn: 4, tư: 4, năm: 5, sáu: 6, bảy: 7, tám: 8, chín: 9, mười: 10,
}
/**
 * The number words checked in the ANSWER ("over ten years" for a 3–5 year teacher is a new number). Not "one" ("one-to-one
 * lessons", "one of my…") and none of năm / một / tư / ba / hai, which double as "year", "a", "private" and place names
 * (Ba Đình, Hai Bà Trưng) — gate review, 2026-10-21.
 */
const ANSWER_NUMBER_WORDS: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, hundred: 100, mười: 10,
}
const WORD = /[\p{L}\p{M}]+/gu
const DEGREE_WORDS = /\b(?:bachelor(?:s|'s|’s)?|master(?:s|'s|’s)|master of|doctorate|ph\.?\s?d|degree)\b|cử nhân|thạc sĩ|tiến sĩ|bằng đại học/i
const DEGREE_ACRONYMS = /(?<![\p{L}\p{N}])(?:BA|BSc|BEd|MA|MSc|MEd|MBA|PhD)(?![\p{L}\p{N}])/u
/**
 * "Native English speaker" — the claim in an answer AND what grounds it in the teacher's own text: ONE pattern, so the
 * own text grounds the claim only by making it (gate review, opus 2026-10-22: a bare "native" — "I teach native
 * Vietnamese kids" — grounded it). The English answer "native" grounds it too (groundsOf).
 */
const NATIVE_CLAIM = /\bnative[\s-]+(?:english[\s-]+)?speaker|\bnative english\b|\benglish native\b|bản ngữ|bản xứ/i
/**
 * "Non-native", "not a native speaker", "không phải người bản ngữ" — a teacher saying they are NOT one: neither a ground for
 * the claim nor a claim (gate review, opus 2026-10-22, measured: "I'm a non-native speaker" grounded "native English
 * speaker" in the answer — a hiring claim on a public page). Taken out of both texts before they are read for it.
 */
const NOT_NATIVE = /\b(?:non|not(?:\s+an?)?)[\s-]*native\b|không\s+phải\s+(?:là\s+)?(?:người\s+)?bản\s+(?:ngữ|xứ)/giu
const withoutNotNative = (s: string) => s.normalize('NFC').replace(NOT_NATIVE, ' ')
const CERTIFIED_OWN = /certif|qualif|chứng chỉ/i

function groundsOf(t: TeacherInput, facts: readonly string[], ownBio: string, jobs: TeacherInput['experience'], certificates: number): BioGrounds {
  const text = `${facts.join('\n')}\n${ownBio}`
  const numbers = new Set<string>()
  for (const m of text.match(NUMBER) ?? []) numbers.add(canonical(m))
  for (const w of ownBio.normalize('NFC').toLowerCase().match(WORD) ?? []) if (Object.hasOwn(NUMBER_WORDS, w)) numbers.add(String(NUMBER_WORDS[w]))
  // The years a job's own dates make ("from 2019-01 to now" → 7 in 2026): what a model computes when it says how long —
  // for the jobs the model was shown only.
  const thisYear = new Date().getUTCFullYear()
  for (const x of jobs) {
    const from = Number.parseInt(x.from.slice(0, 4), 10)
    const to = x.to ? Number.parseInt(x.to.slice(0, 4), 10) : thisYear
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) for (const n of [to - from, to - from + 1]) numbers.add(String(n))
  }
  return {
    text: text.toLowerCase(),
    numbers,
    native: t.englishLevel === 'native' || NATIVE_CLAIM.test(withoutNotNative(ownBio)),
    degree: (!!t.degreeLevel && t.degreeLevel !== 'no-degree') || DEGREE_WORDS.test(ownBio) || DEGREE_ACRONYMS.test(ownBio),
    certified: certificates > 0 || CERTIFIED_OWN.test(ownBio),
  }
}

/** Certificates, exams and curricula a school checks — named in the answer only if named in the input. */
const NAMED_CLAIMS = ['CELTA', 'TEFL', 'TESOL', 'TESL', 'TKT', 'PGCE', 'QTS', 'IELTS', 'TOEIC', 'TOEFL', 'Cambridge', 'IGCSE', 'Montessori'] as const
const namedIn = (name: string, text: string) => new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'iu').test(text)
/** DELTA the certificate — never "Mekong Delta": upper case, or "Delta" beside a certificate word. */
const DELTA_CLAIM = /(?<![\p{L}\p{N}])DELTA(?![\p{L}\p{N}])|\bDelta\b(?=[\s-]+(?:certificate|qualification|qualified|module|holder))|\bCambridge Delta\b/u
// "Certified" alone — never "certificate" / "chứng chỉ": in Vietnamese an IELTS score is a "chứng chỉ IELTS" (real-model eval,
// 2026-10-21), and a named certificate is NAMED_CLAIMS' to check.
const CERTIFIED_CLAIM = /\bcertified\b/i

/**
 * What in `bio` the input does not support — the kinds, never the words (a route logs these). Empty: nothing found.
 * ⚠️ A backstop (see the header): a claim in plain words is not caught here.
 */
export function ungroundedClaims(bio: string, g: BioGrounds): Array<'number' | 'named' | 'delta' | 'native' | 'degree' | 'certified'> {
  const out = new Set<'number' | 'named' | 'delta' | 'native' | 'degree' | 'certified'>()
  for (const m of bio.match(NUMBER) ?? []) if (!g.numbers.has(canonical(m))) out.add('number')
  for (const w of bio.normalize('NFC').toLowerCase().match(WORD) ?? []) if (Object.hasOwn(ANSWER_NUMBER_WORDS, w) && !g.numbers.has(String(ANSWER_NUMBER_WORDS[w]))) out.add('number')
  for (const name of NAMED_CLAIMS) if (namedIn(name, bio) && !namedIn(name, g.text)) out.add('named')
  if (DELTA_CLAIM.test(bio) && !namedIn('delta', g.text)) out.add('delta')
  if (NATIVE_CLAIM.test(withoutNotNative(bio)) && !g.native) out.add('native')
  if ((DEGREE_WORDS.test(bio) || DEGREE_ACRONYMS.test(bio)) && !g.degree) out.add('degree')
  if (CERTIFIED_CLAIM.test(bio) && !g.certified) out.add('certified')
  return [...out]
}

// ── THE ANSWER ──────────────────────────────────────────────────────────────────────────────────────────────────

export type BioRejection = 'empty' | 'thin' | 'long' | 'placeholder' | 'ungrounded' | 'same'
export type BioVerdict = { ok: true; bio: string } | { ok: false; reason: BioRejection }

/** Bracketed slots, template braces, tags — or the data block's own headings echoed back. */
const PLACEHOLDER = /\[[^\]\n]{0,60}\]|\{[^}\n]{0,60}\}|<[^>\n]{0,60}>|PROFILE ANSWERS|OWN ABOUT TEXT|TEACHER DATA/i
/** Letters and digits only, lower case — one text whatever its spacing, case or punctuation. */
const squashed = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * The model's text as a bio Publish accepts — or why it is not one. In order: entities decoded (a model can answer in
 * them — import-map.ts), markdown and list markers out (the page prints the bio as plain text, pre-line), every
 * sentence Publish would refuse dropped and the whole re-screened, cut at a sentence end ≤ LIMITS.bio (publishableBio);
 * then: no placeholder; not the teacher's own text back; at least ABOUT_WORDS_FLOOR words (under it the profile leaves
 * search unless a public video plays — search-floor.ts) and at most BIO_MAX_WORDS; and nothing the input does not
 * support (ungroundedClaims).
 * ⛔ NEVER THE TEACHER'S OWN TEXT HANDED BACK AS A SUCCESS — neither as a fallback (the rephrase route's) nor as the
 * model's own echo (gate review, codex 2026-10-22: 'same' — asked again, told why).
 */
export function acceptTeacherBio(text: string, req: TeacherBioRequest): BioVerdict {
  const plain = stripMarkdown(decodeEntities(text))
    .replace(/^[ \t]*[-•*][ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
  // Too long is judged BEFORE publishableBio, which cuts at LIMITS.bio (gate review, codex 2026-10-22): an answer past
  // either bound is asked again — never cut and kept.
  if (wordCount(plain) > BIO_MAX_WORDS || plain.length > LIMITS.bio) return { ok: false, reason: 'long' }
  const bio = publishableBio(plain)
  if (!bio) return { ok: false, reason: 'empty' }
  if (PLACEHOLDER.test(bio)) return { ok: false, reason: 'placeholder' }
  if (req.ownBio && squashed(bio) === squashed(req.ownBio)) return { ok: false, reason: 'same' }
  if (wordCount(bio) < ABOUT_WORDS_FLOOR) return { ok: false, reason: 'thin' }
  if (ungroundedClaims(bio, req.grounds).length) return { ok: false, reason: 'ungrounded' }
  return { ok: true, bio }
}
