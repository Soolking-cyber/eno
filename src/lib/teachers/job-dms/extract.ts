/**
 * JOB POSTS → FACTS (owner, 2026-10-20: "a matching algorythm with laya in the box so it can confidently match our existing
 * teachers with related cover lessons jobs with accurate location qualification … and salary match if specified").
 *
 * The RULES reading of a job post — pure, deterministic, unit-tested — and the only one that decides: Laya (laya.ts)
 * answers questions on the same text, and its answers are recorded beside these (facts.ts LAYA_ROLE). Every field here is "stated" or absent:
 * a requirement the post does not state is never invented, so a gate can only ever narrow on something the post said.
 *
 * Inputs are posts from Facebook groups (contacts already redacted on the Mac), LinkedIn job-alert emails and posts the
 * outreach team forwards — English and Vietnamese. Everything is matched on the FOLDED text (fold.ts: lower case, no
 * diacritics, đ → d), padded so a rule can match at either end.
 *
 * ⛔ WHAT THIS NEVER EXTRACTS: a gender, an age, a race or a nationality AS A FACT ABOUT THE JOB. A post that asks for one
 * is refused whole (denyReason) — eno.vn's own job screen (job-listing.ts JOB_DENY, Labour Code 2019 art. 8) — and teacher
 * profiles hold no gender or age by design (import-ai.ts, photo-check.ts). "Native speaker" is read as an ENGLISH-LEVEL
 * statement and gated on the teacher's own englishLevel, never on nationality (gates.ts).
 */
import { fold } from '@/lib/fold'
import { jobDenyReason } from '@/lib/job-listing'
import { isVisaWorded } from '@/lib/teachers/match-emails'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { VN_PROVINCES } from '@/lib/vn-areas'
import { HCMC, ONLINE, TOWN_ALIASES, provinceKeyOf } from '@/lib/teachers/places'

/** Bump when a rule below changes what it extracts: stored facts carry it, and a run re-reads posts under an older one. */
export const RULES_VERSION = 'job-rules-2026-10-21c'

export type JobKind = 'job_offer' | 'cover_request' | 'job_seeker' | 'other'
export type Employment = 'full_time' | 'part_time' | 'cover' | 'private' | 'online'
export type Poster = 'school' | 'agency' | 'teacher' | 'parent' | 'unknown'
export type Need = 'required' | 'preferred' | 'none'
export type PayUnit = 'hour' | 'session' | 'day' | 'month' | 'unknown'
export type Pay = {
  /** whole VND (a USD figure converted at USD_VND) — per `unit` */
  min: number
  max: number
  unit: PayUnit
  /** the figure's words as read (folded, ≤40 chars) — a record only: the message builds its own (compose.ts payText) */
  text: string
}
export type Schedule = {
  /** ISO date (Vietnam) when the post names a day, else null */
  date: string | null
  /** 'mon'..'sun' when known (from the date or a weekday word) */
  day: string | null
  /** 'am' (7–12) | 'pm' (12–17) | 'eve' (17–21) when a time or a part of the day is named */
  part: 'am' | 'pm' | 'eve' | null
  /** the lesson's start hour (0–23, Vietnam) when a clock time is stated — a same-evening cover is offered until an hour
   *  before it (facts.ts), where a part alone ends at the part's start */
  hour: number | null
  /** "Sat 25 Oct, 18:00–19:30" — built from what was parsed, never copied from the post */
  label: string
}
export type Requirements = {
  native: Need
  degree: Need
  tefl: Need
  /** "at least N years" when stated */
  minYears: number | null
  /** a post that says the teacher must already be in Vietnam */
  inVietnam: boolean
  /** a post that welcomes applicants from abroad (relocation, flights) */
  abroadOk: boolean
}
export type RuleFacts = {
  version: string
  kind: JobKind
  employment: Employment[]
  poster: Poster
  /** teach-area keys (places.ts PLACE_KEYS: hubs, HCMC districts, p-<code>, 'online') */
  places: string[]
  /** true when the most specific place is a whole city (no district) — cover requests need better */
  cityOnly: boolean
  pay: Pay | null
  schedule: Schedule | null
  ageGroups: ('kids' | 'teens' | 'adults')[]
  subjects: string[]
  /** the other languages it teaches, when it teaches one (readLanguages): 'spanish', 'chinese' … */
  languages: string[]
  requirements: Requirements
  /** set when the post must never be matched — see denyReason */
  deny: DenyReason | null
  /** a person-directed nationality/gender/age/looks word the refusals could not place — the post is HELD (facts.ts) */
  mention: Mention | null
}

export type Mention = 'nation' | 'country' | 'passport' | 'gender' | 'age' | 'looks'

export type DenyReason =
  | 'discriminatory' | 'adult-venue' | 'fee'
  | 'gender' | 'nationality' | 'visa-only' | 'not-vietnam' | 'vietnamese-oriented'

/** A USD figure is compared in VND at this rate (2026-10). Only a ±10 % pay gate reads it — not shown to anyone. */
export const USD_VND = 26_000

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Text
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The folded, padded text every rule reads. */
export function foldPost(text: string): string {
  return ` ${fold(text.normalize('NFKC')).replace(/[‘’]/g, "'").replace(/[–—]/g, '-')} `
}

const has = (t: string, re: { test: (s: string) => boolean }) => re.test(t)

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Refusals — a post that is refused whole is never matched, never stored as "ready", never quoted
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A GENDER ASK beyond JOB_DENY's "(fe)males only": "need a female teacher", "female preferred", "GV nữ", "giáo viên nam".
 * ⚠️ "female students" / "girls' school" describe the class, not the teacher — only a teacher/tutor/candidate noun right
 * after the gender word, or "preferred/only" right after it, counts.
 */
/** Vietnamese, folded: "giáo viên bản ngữ nữ", ", nữ,", "(nữ)", "nữ giáo viên" — "nữ" is female (opus, gate 1e). ⚠️ "nam"
 *  is also "Việt Nam", "south" (Nam Phi) and, folded, "năm" (a year: "300 triệu/năm" — opus, gate 2d), so it counts only
 *  in a gender field ("Giới tính: Nam", exclusiveGender). */
const VI_GENDER_ASK = /\b(giao vien|gv|co giao|ung vien|tuyen|can)( [a-z]+){0,2} nu\b(?! (sinh|hoc sinh|sinh vien))|[,(;:]\s*nu\s*[,);/]|\(\s*nam\s*\)|\bnu (giao vien|gv)\b|\b(chi|uu tien) (tuyen )?(nu|nam)\b/
const GENDER_ASK = /\b(fe)?males?\b[^.!?\n]{0,40}\b(teachers?|tutors?|candidates?|applicants?|staff|speakers?)\b|\b(need|needs|looking for|want|wanted|hiring|seeking)\b[^.!?\n]{0,20}\b(an? |\d+ )?(man|men|woman|women|lady|ladies|girl|guy|boy)\b|\b(man|woman|lady|girl|guy)\b[^.!?\n]{0,30}\b(english |esl |native )?teachers?\b|\b(fe)?males? (are )?(preferred|prefered|priority|prior|only)\b|\bfemail\b|\((fe)?male\)|\b(gv|giao vien|co giao|thay giao) (nu|nam)\b|\buu tien (gv |giao vien )?(nu|nam)\b|\b(lady|ladies|woman|women|man|men|girl|guy) teachers?\b/
const COUNTRY = '(the )?(us|usa|u\\.s\\.?a?|united states|america|americans?|uk|u\\.k\\.|united kingdom|england|britain|great britain|british|scotland|wales|ireland|irish|canada|canadians?|australia|australians?|new zealand|south africa|south africans?|philippines|the philippines|nigeria|ghana|kenya|uganda|zimbabwe|cameroon|india|europe|eu|european union|europeans?|ukraine|russia|serbia|belarus|poland|germany|france|spain|italy|netherlands|sweden|norway|denmark|finland|romania|bulgaria|hungary|czech republic|czechia|slovakia|croatia|greece|portugal|jamaica|singapore|malaysia|pakistan|kazakhstan|georgia|armenia|turkey|brazil|mexico|colombia)'
/**
 * A NATIONALITY / PASSPORT / ORIGIN ask — measured on 270 labelled posts (2026-10-20): 38 asked one, mostly in the forms
 * the VN ESL market uses as job categories: "Filipino teachers", "NES or EU", "(Native, EU & Filipino)", "European
 * preferred", "teachers from Nigeria, Ghana, Kenya …", "native teachers from the US, UK, Canada …". eno never filters
 * teachers by nationality (gates.ts) and refuses ads that do (job-listing.ts JOB_DENY's refusal copy), so such a post is
 * dropped whole. ⚠️ NOT an ask: "native OR NON-native teachers" (inclusive), and "Vietnamese teachers" (colleagues —
 * a Vietnamese-only post is caught by vietnameseWithoutForeignerCue).
 */
const NATIONALITY_ASK = new RegExp([
  String.raw`\b(passports?( holders?)?|nationals?|citizens?|nationality) (from|of)\b`,
  // a form field or a passport by country: "Nationality: USA/UK", "Quốc tịch: Mỹ", "Must hold a UK or US passport"
  String.raw`\b(nationality|quoc tich)\s*:\s*(?!(any|all|open|none|no |not |khong))[a-z]`,
  String.raw`\b${COUNTRY}(\s*(,|\/|or|and|&)\s*${COUNTRY})* passports?\b|\b(western|native|english.?speaking|eu|european|first.?world) (country )?passports?\b`,
  // "US citizens only", "U.S. citizens preferred", "citizens only" (opus, gate 1c)
  String.raw`\b${COUNTRY} (citizens?|citizenship|nationals?|nationality)\b|\bcitizens? only\b`,
  // "giáo viên Tây" / "người Tây" — a WESTERN teacher, an origin ask in Vietnamese (opus, gate 1c)
  String.raw`\b(giao vien|gv|thay|co|nguoi) tay\b`,
  String.raw`\bfrom ${COUNTRY}(\s*(,|/|or|and|&)\s*${COUNTRY})+\b`,
  // a bare list of three or more countries — "(UK, Australia, USA, New Zealand, Canada, Ireland)"
  String.raw`\b${COUNTRY}\s*(,|/|or|and|&)\s*${COUNTRY}\s*(,|/|or|and|&)\s*${COUNTRY}\b`,
  String.raw`\bfrom (an? |the )?(native.?)?(english.?speaking|european|western|anglophone) countr(y|ies)\b|\bfrom a country where english is (the |an? )?(first|native|official|main|primary)\b`,
  String.raw`\b(eu|european)s? (with|or|and|/|\()`,
  String.raw`\b(british|american|irish|australian|canadian|north american|western|south african)( or [a-z]+)? accents?\b`,
  // glued to a number in a heading: "DISTRICT 12European Teacher"
  String.raw`(^|[^a-z])(europeans?|europe|filipinos?|filipinas?) (english |esl |efl )?teachers?\b`,
  String.raw`\b(teachers?|candidates?|applicants?|speakers?|tutors?) from ${COUNTRY}\b`,
  String.raw`\b(philippines?|filipinos?|filipinas?|filippinos?|pinoy|europeans?|eu|south africans?|americans?|british|canadians?|australians?|irish|africans?|nigerians?|indians?|westerners?) (english |esl |efl )?(nationals?|teachers?|tutors?|candidates?|applicants?|citizens?|only|preferred|priority)\b`,
  String.raw`\((filipinos?|filipinas?|philippines|europeans?|eu|westerners?)( teachers?)?\)`,
  String.raw`\b(native|nes)\s*(,|&|and|/|or)\s*(eu|europeans?|europe|filipinos?|filipinas?|philippines)\b`,
  // origin by exclusion: "Teachers from non-Asian countries are preferred"
  String.raw`\bnon.?(asians?|africans?|filipinos?|europeans?)\b`,
  // the one nationality a Vietnam post can ask for outright: "English Tutor (Vietnamese people)"
  String.raw`\((vietnamese|vietnamese people|vietnamese nationals?|vietnamese citizens?|nguoi viet( nam)?)( only)?\)|\bvietnamese (people|nationals?|citizens?) only\b|\bonly vietnamese (people|nationals?|citizens?|teachers?)\b`,
  String.raw`\b(eu|europeans?|filipinos?|filipinas?|philippines)\s*(&|and|/|or)\s*(filipinos?|filipinas?|philippines|native|nes|eu|europeans?)\b`,
  String.raw`\b(only|chi) (filipinos?|europeans?|eu|nes|westerners?)\b`,
  // origin by exclusion, in brackets anywhere: "(expats only)", "[Foreigners Only]" — a title's own is titleAsksNationality
  String.raw`[\[(]\s*(expats?|foreigners?|foreign|non.?vietnamese)( (teachers?|candidates?|applicants?))?[ -]only\s*[\])]`,
  // "Westerner or NES", "NATIVE SPEAKERS or WESTERNES" (sic) — the noun, never the adjective ("Western curriculum")
  String.raw`\bwesterne?r?s\b|\bwesterner\b`,
  // origin by proxy: "candidates with a European or Western educational background are highly preferred"
  String.raw`\b(european|western|american|british|native.?speaking country) (educational |education |cultural )?background\b`,
  // a nationality adjective on the person: "an American native speaker", "a British host"
  String.raw`\b(americans?|british|canadians?|australians?|irish|south africans?|filipinos?|europeans?) (native |english |native english )?(speakers?|hosts?|persons?|people)\b`,
  String.raw`\b(us|usa|uk|ca|au|aus|nz|ie|ire|za|can|american|british|canadian|australian)( ?[/,] ?| or | and )(us|usa|uk|ca|au|aus|nz|ie|ire|za|can|american|british|canadian|australian)( ?[/,] ?| or | and )(us|usa|uk|ca|au|aus|nz|ie|ire|za|can|american|british|canadian|australian)\b`,
  String.raw`\b(7|seven|six|6) native (english )?(speaking )?countries\b`,
  String.raw`\bgiao vien (philippines|phi|chau au|au my|anh my|nam phi)\b|\bgv (phi|chau au|au my)\b`,
].join('|'))
/** Race, religion and a candidate's age range, in the forms JOB_DENY does not list. ⚠️ Students' ages ("kids 6-8 years
 *  old", "students aged 18-25") are the class, not the teacher: an age only counts tied to the candidate. */
const PERSON_ASK = /\b(non.?(muslim|christian|buddhist|hindu)|(muslims?|christians?|buddhists?) only)\b|\b(nguoi |giao vien |gv )?da (trang|den|mau)\b|\b(white|black|caucasian|asian|fair.?skinned) (teachers?|people|faces?|candidates?|looking)\b|\b(teachers?|candidates?|applicants?)( must be| should be|,)? (aged|between) (1[89]|[2-6]\d)\b|\b(age[ds]?|do tuoi|tuoi)\s*:?\s*(from |between |tu )?(1[89]|[2-6]\d)\s*(-|to|den|toi|and)\s*([2-9]\d)\b|\b(age|do tuoi|tuoi)\s*:?\s*(under|below|over|above|max(imum)?|no more than|less than|up to|duoi|tren|<|>)\s*([2-6]\d)\b|\b(candidates?|applicants?|teachers?) (under|below|over|above) ([3-6]\d)( years old| y\.?o\.?)?\b|\b(male|female)\s*,?\s*(1[89]|[2-6]\d)\s*(-|to)\s*([2-6]\d)\b/

/**
 * THE NET UNDER THE REFUSALS — a person-directed NATIONALITY, COUNTRY, GENDER, a candidate's AGE or LOOKS, anywhere.
 * Each labelled set found asks the refusals above had no form for ("Philipines Teacher", "2 Female native", "Western
 * teachers … also welcome", "country of passport" — four sets, four new lists, 2026-10-20): the phrase list was not
 * converging, so a post that names any of these is HELD (facts.ts), never sent. Plainly other uses are let through: an
 * institution's or curriculum's name ("British International School", "UK centre"), the students ("6-year-old girl",
 * "learners aged 3 to 5"), a greeting ("hi guys"), "male or female". Measured on the 630 labelled posts: precision of
 * what would be sent 0.961 → 0.983 (held-out 4: 0.898 → 0.975), no good post held — in-sample, as the exemptions were
 * read off those sets; the shadow run's grading is the out-of-sample check.
 */
const NAT_WORDS = String.raw`americans?|british|brits?|canadians?|australians?|aussies?|irish|scottish|welsh|kiwis?|new zealanders?|south africans?|(ph|f)il+ip+in(es?|os?|as?)|pinoys?|europeans?|westerners?|africans?|nigerians?|ghanaians?|kenyans?|indians?|russians?|ukrainians?|asians?|caucasians?|non.?asians?`
const COUNTRY_WORDS = String.raw`usa|united states|america|uk|u\.k\.|united kingdom|england|britain|scotland|wales|ireland|canada|australia|new zealand|south africa|nigeria|ghana|kenya|uganda|zimbabwe|cameroon|india|europe|ukraine|russia|serbia|belarus|poland|germany|france|spain|italy|jamaica|pakistan|kazakhstan`
const NAMED_THING = new RegExp(String.raw`\b(${NAT_WORDS}|${COUNTRY_WORDS}|western|korean|japanese|german|french|singapore(an)?|chinese|vietnamese)\s+(international |bilingual |private )?(schools?|curricul(um|a)|programs?|programmes?|council|standards?|system|academy|university|college|qualifications?|education|textbooks?|materials|methods?|exams?|board|embassy|consulate|compan(y|ies)|clients?|partners?|expats? community|cent(er|re)s?|branch|campus)\b`, 'g')
const MENTIONS: [Mention, RegExp][] = [
  // Other nationalities only on a person ("French teachers only" — codex, gate 1e): bare, they are mostly places ("Thai
  // Binh", "Thai Nguyen"), languages and posters describing themselves ("I'm Korean"), measured on the labelled sets.
  ['nation', new RegExp(String.raw`\b(${NAT_WORDS})\b|\b(french|germans?|chinese|japanese|koreans?|spanish|italians?|dutch|swedish|polish|portuguese|brazilians?|mexicans?|thai|malaysians?|singaporeans?|indonesians?) (native )?(teachers?|tutors?|speakers?|candidates?|applicants?|people|nationals?|only|preferred)\b|\bwestern (teachers?|people|candidates?|applicants?|faces?|speakers?|looking)\b|\b(white|black|fair.?skinned|light.?skinned) (people|teachers?|skin|faces?|candidates?)\b`, 'g')],
  ['country', new RegExp(String.raw`\b(${COUNTRY_WORDS})\b`, 'g')],
  ['passport', /\bpassports? (holders?|from|of)\b|\bcountr(y|ies) of (passport|origin|birth|citizenship)\b|\bpassport countr(y|ies)\b|\bcitizens? (of|from)\b/g],
  ['gender', /\b(fe)?males?\b|\b(wo)?man\b|\b(wo)?men\b|\blad(y|ies)\b|\bgirls?\b|\bguys?\b|\bgentlem[ae]n\b|\b(gv|giao vien|co giao|thay giao|ung vien|uu tien) (nu|nam)\b|\bgioi tinh\b|\bgender\b|\bsex\b/g],
  ['age', /\b(candidates?|applicants?|teachers?|you)\b[^.!?\n]{0,30}\b(aged?|years? old)\b|\b(aged?|tuoi|do tuoi)\s*:?\s*(from |between |tu |under |below |over |max(imum)? )?(1[89]|[2-9]\d)\b|\b(age limit|maximum age|max age|age requirement|age range)\b/g],
  ['looks', /\b(good.?looking|attractive (appearance|looks?)|appearance|handsome|height|weight|photo of yourself|full.?body)\b/g],
]
const GENDER_OTHER = /\b(fe)?males? (and (fe)?males? )?(students?|learners?|kids|children|pupils|class(es)?)\b|\bgirls?'?s? (school|class(es)?)\b|\b(years?.?olds?|my|our|a|the|his|her|little) (girls?|boys?|daughters?|sons?)\b|\b(hi|hello|hey|you|thanks|thank you) guys\b|\bguys[!,]|\bboys and girls\b|\bgirls and boys\b|\b(fe)?male (and|or|&|\/) (fe)?male\b|\ball genders?\b|\bwomen'?s (day|month)\b/
const AGE_OTHER = /\b(learners?|students?|kids?|children|child|pupils?|sons?|daughters?|boys?|girls?|babies|toddlers?|hoc sinh|be|tre)\b[^.!?\n]{0,12}\b(aged?|years?.?old|\d+ (months?|years?))\b|\byears?.?olds? (boys?|girls?|sons?|daughters?|child|children|kids?|students?|learners?)\b/

/** The first person-directed demographic word in folded text `t`, or null — see the block above. */
export function demographicMention(t: string): Mention | null {
  const s = t.replace(NAMED_THING, ' ')
  for (const [name, re] of MENTIONS) {
    for (const m of s.matchAll(re)) {
      const at = m.index ?? 0, end = at + m[0].length
      if (name === 'gender' && GENDER_OTHER.test(s.slice(Math.max(0, at - 25), end + 25))) continue
      if (name === 'age' && AGE_OTHER.test(s.slice(Math.max(0, at - 30), end + 30))) continue
      return name
    }
  }
  return null
}

export function denyReason(text: string): DenyReason | null {
  const deny = jobDenyReason(text)
  if (deny) return deny
  const t = foldPost(text)
  // "Male and female teachers welcome" is the opposite of a gender ask.
  const exclusiveGender = has(t, /\b(gender|sex|gioi tinh|requirements?|yeu cau)\s*:?\s*(-\s*)?((fe)?males?|nu|nam)\b(?!\s*(or|and|&|\/|hoac|va|,)\s*((fe)?males?|nu|nam)\b)|\b(need|needs|looking for|want|wanted|hiring|require|requires|prefer|seeking)\b[^.!?\n]{0,30}\b(an? |\d+ )?(?<!\b(fe)?males?\s*(or|and|&|\/)\s*)(fe)?males?\b(?! (or|and|&|\/) (fe)?male)|\b(fe)?males? (only|preferred|priority|prior)\b|\bfemail\b|\b(gv|giao vien|co giao|thay giao) (nu|nam)\b|\buu tien (gv |giao vien )?(nu|nam)\b/)
  // "Giới tính: Nam/Nữ" is inclusive (opus, gate 2b), as are "male and female", "any gender", "không phân biệt giới tính"
  // — but a comma pairs them only after "giới tính": "tại Việt Nam, nữ, Quận 3" is an ask (opus, gate 2c).
  const inclusiveGender = has(t, /\b(fe)?male (and|or|&|\/) (fe)?male\b|\ball genders?\b|\bany gender\b|\bregardless of gender\b|\bgioi tinh\s*:?\s*(nam|nu)\s*(\/|va|hoac|&|,)\s*(nu|nam)\b|\b(nam|nu)\s*(\/|va|hoac|&)\s*(nu|nam)\b|\bkhong (yeu cau|phan biet) gioi tinh\b/)
  if (exclusiveGender || ((has(t, VI_GENDER_ASK) || has(t, GENDER_ASK)) && !inclusiveGender)) return 'gender'
  if (has(t, NATIONALITY_ASK)) return 'nationality'
  // The teacher pays to get the job ("the visa invitation letter fee must be paid upfront and will be reimbursed").
  if (has(t, /\bpaid upfront\b|\bupfront (fees?|payments?|costs?|deposits?)\b|\b(fees?|deposits?) (must|should|has to|have to|needs? to|will) be paid (upfront|in advance|before|by (the )?(teachers?|candidates?|applicants?|you))\b|\b(pay|paid|transfer) (a |the )?(deposit|registration fee|placement fee|application fee|training fee)\b/)) return 'fee'
  if (has(t, PERSON_ASK)) return 'discriminatory'
  // "Requirements: max 40 years old" — a candidate's age with no person noun (opus, gate 1c); the students' ("students
  // under 18 years old") are the class.
  for (const m of t.matchAll(/\b(max(imum)?|under|below|not over|no older than|up to|over|above|at least|min(imum)?|duoi|tren|khong qua)\.?\s*:?\s*(1[89]|[2-9]\d)\s*(years? old|yrs? old|y\.?o\.?|tuoi)\b|\b(1[89]|[2-6]\d)\s*(-|–|~|den|toi|to)\s*([2-6]\d)\s*(tuoi|years? old)\b/g)) {
    if (!/\b(students?|learners?|kids?|children|pupils?|class(es)?|adults?|working professionals|working adults|hoc sinh|hoc vien|sinh vien|nguoi lon|nguoi di lam|cac be|cho be|day be|tre em|tre)\b[^.!?\n]{0,20}$/.test(t.slice(Math.max(0, (m.index ?? 0) - 30), m.index))) return 'discriminatory'
  }
  // A post about work OUTSIDE Vietnam (China, Korea, the Middle East …) on a Vietnam group: not a job here.
  if (has(t, /\b(teach|teaching|jobs?|positions?|schools?) (in|at) (china|korea|japan|taiwan|thailand|cambodia|dubai|uae|saudi arabia|qatar|kuwait|oman|spain|turkey)\b/) && !has(t, /\b(vietnam|viet nam|hcmc|saigon|hanoi|ha noi|da nang)\b/)) return 'not-vietnam'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Kind, employment, poster
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A TEACHER OFFERING THEMSELVES — first person and looking/available, or a headline that sells a teacher ("English
 * teacher available", "looking for a position"). Measured on 270 labelled posts (2026-10-20): a narrower pattern read 15
 * seekers as jobs, mostly "I'm available tomorrow for cover classes" — which is a teacher, not a cover request.
 */
const SEEKER = new RegExp([
  // a self-description as a teacher ("I'm an experienced TEFL teacher …", "My name is … I'm a native teacher")
  String.raw`\b(i am|i'm|im)\s+(?!(currently |now |urgently |still )?(looking|seeking|searching|hiring|in need|needing|need|recruiting|trying|writing|posting|sharing|asking)\b)(an? |the )?([a-z-]+ ){0,4}(teachers?|tutors?|educators?)\b(?! (for|needed|wanted))`,
  // first person looking for WORK (never "I'm looking for a teacher" — that is an employer)
  String.raw`\b(i am|i'm|im|i) (currently |actively |now )?(looking|seeking|searching) for (an? )?((new|teaching|tutoring|english|esl|full.?time|part.?time|online|weekend|evening|cover|private|long.?term|stable|or|and|\/) )*(teaching |tutoring )?(jobs?|work|positions?|roles?|opportunit(y|ies)|classes|students|employment)\b`,
  // a headline selling a teacher
  String.raw`\b(teachers?|tutors?|educators?) (is |are )?(available|looking for (a |an )?(job|position|work|role|opportunit))`,
  String.raw`\b(available|free) (for|to (take|do|teach)) (cover|classes|work|teaching|tutoring|private|substitut)`,
  String.raw`\bi need a job\b|\bi can teach (you|your)\b|\bmy (cv|resume)\b|\b(hire|dm) me\b|\byou'?ve found one\b|\bopen to (new )?(opportunities|offers)\b|\brelocat(e|ing) to vietnam\b|\btim viec\b|\bcan tim (viec|lop)\b`,
].join('|'))
/** An employer's own voice — outranks seeker words ("we're hiring … if you are available"). */
const EMPLOYER_VOICE = /\bwe('re| are) (hiring|recruiting)\b|\bwe('re| are) (looking for|seeking|in need of)\b[^.!?\n]{0,40}\b(teachers?|tutors?|instructors?|lecturers?|educators?|candidates?|staff)\b|\bnow hiring\b|\bour (center|centre|school|academy|company|kindergarten|campus|branch)\b|\bjob description\b|\btuyen (dung|gap|giao vien|gv)\b/
/** ⚠️ NOT employer voice, measured: "if your school IS HIRING", "any VACANCIES?" — seekers write both. */
/** A TEACHING role — required for a job: "we're hiring" alone is a TikTok streamer, a sales rep, a donut shop. */
const TEACH_ROLE = { test: (t: string) => TEACHER_NOUN.test(t) || /\b(esl|efl|tefl|ielts|toeic|cambridge|phonics)\b/.test(t) }
/** Assistant/intern roles are not teaching jobs here (owner, 2026-09-25: "no assistant no intern things"). */
const ASSISTANT_ONLY = /\b(teaching assistants?|teacher'?s? assistants?|ta|tas|tro giang|tro ly|interns?|internship|thuc tap)\b/
/** A teacher NOUN once the assistant phrases are taken out — "Hiring Teacher Assistants" names no teacher (opus, gate 1c). */
const TEACHER_NOUN = /\b(teachers?|tutors?|lecturers?|educators?|homeroom|giao vien|gv)\b|\b(english|esl|efl|ielts|toeic|toefl|language|phonics|cambridge|speaking|communication|kids?) (trainers?|coach(es)?|instructors?)\b|\b(trainers?|coach(es)?|instructors?)\b[^.!?\n]{0,25}\b(english|esl|ielts|phonics)\b|\binstructors?\b[^.!?\n]{0,25}\b(kindergarten|preschool|young learners?)\b|\b(kindergarten|preschool|young learners?) (english )?(trainers?|instructors?)\b/
const withoutAssistants = (t: string) => t
  .replace(/\b(teaching assistants?|teacher'?s? assistants?|tro giang|tro ly|interns?|internship|thuc tap)\b/g, ' ')
  // "Teacher Recruitment Specialist", "Teacher Training Coordinator" — a job ABOUT teachers (opus, gate 1d)
  .replace(/\b(teachers?|tutors?) (recruitment|recruiting|sourcing|placement|hiring|training|support|relations?) (specialists?|officers?|executives?|consultants?|managers?|coordinators?|partners?|leads?|associates?|staff)\b/g, ' ')
/** A role that is not teaching — "IELTS Sales Consultant", "Admissions Officer · IELTS Centre", "sales staff at our TEFL
 *  academy" (codex + opus, gate 1c): an exam name or a school word is not a teaching role. */
const NON_TEACHING_ROLE = /\b(sales|admissions?|marketing|consultants?|counsel+ors?|receptionists?|managers?|coordinators?|accountants?|administrative|admin staff|customer (service|care)|telesales|recruiters?|officers?|executives?|drivers?|nann(y|ies)|babysitters?|chefs?|cleaners?)\b/
const HIRING_CUE = new RegExp([
  String.raw`\b(hiring|recruiting|need(s|ed)?|looking for|seeking|searching for|require(s|d)?|want(s|ed)?|in need of)\b[^.!?\n]{0,60}\b(teachers?|tutors?|instructors?|lecturers?|educators?)\b`,
  String.raw`\b(teachers?|tutors?|instructors?|lecturers?) (wanted|needed|required|positions?|vacanc(y|ies)|recruitment|job)\b`,
  String.raw`\bjob (opening|vacancy|offer|description)\b|\b(positions?|vacanc(y|ies)) (available|open)\b`,
  String.raw`\btuyen\b[^.!?\n]{0,40}\b(giao vien|gv)\b|\bcan (gap |tuyen )?(giao vien|gv)\b`,
].join('|'))
/** A question or a discussion, not an offer: "does anyone know…", "has anyone had success…". */
const DISCUSSION = /\b(does|can|has|have|did|would) anyone\b|\banyone (know|recommend|tried|had|here)\b|\b(any|some) (advice|tips|recommendations?)\b|\bquestion\b|\bwhat do you (think|guys)\b/
/** A COVER: never the bare word ("health cover", "covered parking") — a cover teacher/class/lesson, or a substitute. */
const COVER = /\bcover(ing)? (teachers?|class(es)?|lessons?|shifts?|sessions?|(for )?(a|an|my|our|the|this|one|two|\d+) (class|classes|lesson|lessons|teacher|kids|session|shift|week|day))\b|\bsomeone to (cover|sub|take|teach) (my|our|a|the)\b|\b(need|needs|needed|looking for|urgent|require|seeking) (an? |one |\d+ )?(cover|sub|substitute)\b|\bsubstitute (teachers?|class(es)?|lessons?|teaching)\b|\bsub teachers?\b|\b(day|giao vien|gv) thay\b|\bthay (giao vien|gv|lop|tiet)\b/
const TEACHER_SWAP = /\b(i|i'm|im) (need|looking for|am looking for) (someone|a teacher|a sub|a cover|cover)\b.{0,40}\b(my|for me)\b|\bcover (my|for my) (class|classes|lesson|lessons|shift)\b|\b(can't|cannot|can not|won't be able to) (make|teach|attend) (it|my|the)\b|\bmy (class|classes|lesson|lessons|students) (on|this|tomorrow|today|tonight)\b/
const PARENT = /\b(my|our) (son|daughter|kids?|child|children|boy|girl|little one)\b|\b(con (toi|minh|em|nha)|phu huynh|be nha)\b|\btutor for (my|our)\b/
const SCHOOL = /\b(english|language|foreign language|ielts|kids|learning) (center|centre|school|academy|club|institute)\b|\b(trung tam|truong|he thong|anh ngu|ngoai ngu)\b|\b(international|bilingual|private|public|primary|secondary|high|kindergarten|preschool|montessori) (school|kindergarten|kindy)\b|\b(our|the) (center|centre|school|academy|campus|campuses|company|branch|branches|students)\b|\b(academy|college|university|institute|edu|education)\b/
const AGENCY = /\b(recruit(er|ers|ment agency)|agency|on behalf of|my clients?|our (partner|client) schools?|placement|headhunt(er|ing)?)\b/

/** English named anywhere in a post: it is (also) an English job. */
const ENGLISH_NAMED = /\b(english|esl|efl|ielts|toeic|toefl|phonics|cambridge|tieng anh)\b/

/**
 * ANOTHER LANGUAGE AS THE SUBJECT (the second shadow run, 2026-10-21: "I am looking for 1 teacher who can teach Spanish for
 * 1 kid class" went to 16 English teachers): the languages a post teaches — taught, tutored or classed, never a nationality
 * beside the job ("Korean kindergarten", "Japanese students"); none when it also names English (an English job, as
 * before). The job is then 'other-language' (readSubjects) — for the teachers who teach that language (gates.ts: profile
 * teachLanguages; 21 teachers hold the subject). Names as teachers write theirs, folded: Mandarin and Cantonese are Chinese.
 * ⚠️ Not Filipino: in these groups "Filipino teachers" names the teachers' nationality (two labelled kindergarten jobs).
 */
const OTHER_LANGUAGES = 'spanish|espanol|french|francais|german|deutsch|japanese|korean|chinese|mandarin|cantonese|russian|italian|portuguese|thai|arabic|hindi|vietnamese|turkish|persian|indonesian|dutch'
// ⛔ PRECISION FIRST, BY WHITELIST (gates 12h–12l: each exclusion list let a new phrasing through — a nationality, a class
// of children, the fellow staff: "teach Korean kindergarten kids", "there is a Vietnamese teacher in every class", "a
// Vietnamese teacher (TA)", "Korean teacher needed for our kindergarten", "teach Vietnamese at our centre", "the school
// also offers Korean lessons"). A missed language job reads as it did before; a misread English job would reach no
// English teacher ('other-language' is a hard subject). So only what cannot be anyone's nationality or a class of
// children: "teach Spanish" before a sentence's end, "lessons", "as a foreign language", "for" a number or a/an/my/our …
// ("teach Spanish for 1 kid class"), "to" foreigners, beginners, my/our … — never "for kindergarten classes", "to
// communicate in English" (gate 12n), nor "learn Korean" (the students do: 12o); "a/an
// Spanish TUTOR" before a parent's words — "for", "who", "needed", "to teach/speak" — never a colleague's ("a Korean
// tutor to support you": 12o), or one opening a sentence or a list item — never "a Spanish teacher" nor "Spanish tutors", which are
// also how a post names colleagues; "give/teach Spanish lessons"; "teacher of Spanish" ending its sentence ("teachers of
// Korean kids", "of Korean, Japanese … students" are not); "Spanish language teacher". Never "classes": a class of
// Korean children is one too (gate 12m).
const LANGUAGE_TAUGHT = [
  new RegExp(`\\b(?:teach(?:ing)?|tutor(?:ing)?) (${OTHER_LANGUAGES})(?=\\s*(?:$|[.!?;:)]|(?:lessons?|as a (?:second|foreign) language)\\b|for (?:\\d|(?:a|an|my|our|your|his|her|their|beginners|adults|foreigners|expats)\\b)|to (?:foreigners|expats|beginners|adults|my|our|your|his|her|their)\\b))`, 'g'),
  new RegExp(`(?:\\b(?:a|an) |(?:^|[.!?:;•\\n]|\\d[.)]) *)(${OTHER_LANGUAGES}) (?:language )?tutor(?=\\s*(?:$|[.!?;:)]|(?:for|who|needed|wanted|required)\\b|to (?:teach|tutor|speak|practi[cs]e)\\b))`, 'g'),
  new RegExp(`\\b(?:give|giving|provide|providing|teach|teaching) (${OTHER_LANGUAGES}) (?:language )?(?:lessons?|courses?)\\b`, 'g'),
  new RegExp(`\\b(?:teachers?|tutors?|instructors?) of (${OTHER_LANGUAGES})(?=\\s*(?:$|[.!?;:)]|as a (?:second|foreign) language\\b))`, 'g'),
  new RegExp(`\\b(${OTHER_LANGUAGES}) language (?:teachers?|tutors?)\\b`, 'g'),
]
const LANGUAGE_NAME: Record<string, string> = { mandarin: 'chinese', cantonese: 'chinese', espanol: 'spanish', francais: 'french', deutsch: 'german' }
/** Only a word the language list knows is looked up — never a profile's "constructor" (opus, gate 12m). */
const canonical = (w: string): string => LANGUAGE_NAME[w] ?? w
/** English as what is TAUGHT — "English teacher", "teach English", ESL, IELTS …; "must be fluent in English" is a
 *  requirement of a Spanish job, not an English job (codex + opus, gate 12i). */
const ENGLISH_TAUGHT = /\b(english (teachers?|tutors?|class(es)?|lessons?|courses?|cent(er|re)s?|schools?|programm?e?s?|curriculum)|teach(ing)? english|to speak english|native english|english (native )?speakers?|(teachers?|tutors?) of english|esl|efl|ielts|toeic|toefl|phonics|cambridge|tieng anh)\b/
export function readLanguages(t: string): string[] {
  // …nor when it recruits a native or foreign teacher: in this market that is an English teacher, whatever else the post
  // says ("Native teacher needed … We also teach Korean", "… a Korean tutor for support": opus, gate 12p)
  if (ENGLISH_TAUGHT.test(t) || FOREIGNER_CUE.test(withoutNegatedCues(t))) return []
  const out = new Set<string>()
  for (const re of LANGUAGE_TAUGHT) for (const m of t.matchAll(re)) out.add(canonical(m[1]))
  return [...out]
}
const LANGUAGE_WORD = new RegExp(`^(${OTHER_LANGUAGES})$`)
/** Vietnamese names a teacher may write ("Tiếng Trung") — folded, as the jobs' names. */
const VI_LANGUAGE_NAME: Record<string, string> = {
  'tieng trung': 'chinese', 'tieng hoa': 'chinese', 'tieng han': 'korean', 'tieng nhat': 'japanese', 'tieng phap': 'french',
  'tieng duc': 'german', 'tieng tay ban nha': 'spanish', 'tieng nga': 'russian', 'tieng thai': 'thai', 'tieng viet': 'vietnamese',
}
/**
 * A teacher's own names for the languages they teach, as the jobs' are read — every one named, not the first word:
 * "Mandarin", "Chinese (Mandarin)", "Simplified Chinese", "French and Spanish", "Español", "Tiếng Trung" (opus, gates
 * 12h–12i). A language the list does not know is kept as written (no job will name it).
 */
export function languageNames(raw: string): string[] {
  const t = ` ${foldPost(raw).replace(/[^a-z]+/g, ' ')} `
  const out = new Set<string>()
  for (const [vi, name] of Object.entries(VI_LANGUAGE_NAME)) if (t.includes(` ${vi} `)) out.add(name)
  for (const w of t.trim().split(' ')) if (LANGUAGE_WORD.test(w)) out.add(canonical(w))
  // a blank entry names nothing (opus, gate 12j)
  return out.size ? [...out] : t.trim() ? [t.trim()] : []
}

/** Teaching ANOTHER subject or activity and no English — "swimming instructors for kids", "football coach for our
 *  kindergarten", "piano teacher" (opus, gate 2d): eno's teachers teach English. */
const OTHER_SUBJECT_ONLY = (t: string) =>
  /\b(piano|guitar|violin|drums|music|singing|art|drawing|painting|dance|dancing|ballet|swimming|swim|football|soccer|basketball|tennis|badminton|volleyball|yoga|chess|martial arts|taekwondo|karate|judo|boxing|cooking|lifeguard|gymnastics)\b/.test(t)
  && !ENGLISH_NAMED.test(t)


/**
 * A ROLE TITLE FOR ANOTHER ACADEMIC SUBJECT (graded 2026-10-21 — the first shadow run offered "Secondary Economics
 * Teacher" to 25 English teachers, "Psychology Teacher (Cambridge, AP)" to 21, "Teacher of History" to 14, a digital-media
 * lecturer to 8): no teacher's profile can say they teach it (profile.ts SUBJECTS), so it fits none. ⛔ THE TITLE ONLY —
 * a listing's or a LinkedIn job's, which says what the job IS: across a whole post the words are prose ("work history",
 * "labour law", "no office politics") and "excellent English required" is a qualification (codex + opus, gate 12a).
 * Kept: a title that also names English or STEM ("English and History Teacher", "Maths and History Teacher") — not a
 * stage or an audience: "History Teacher for Kids" is a History job (codex, gate 12c). A Facebook post has no title and
 * is not screened. ⚠️ ACCEPTED, as before this rule (every such job then went to every English teacher): a free-text
 * title that puts the employer first ("Teachers International — Economics Teacher") or English in a requirement
 * ("Economics Teacher (English language required)") is still read as a job — the titles seen are "role — employer"
 * (imports) and a bare role (LinkedIn) (codex, opus, gate 12d).
 */
const OTHER_ACADEMIC_TITLE = /\b(economics|psychology|history|geography|sociology|philosophy|politics|humanities|global perspectives|accounting|business studies|business administration|business management|human resources|digital media|animation|graphic design|drama|theatre|theater|physical education|social studies|religious studies|law|marketing|finance|engineering|nursing|hospitality|artificial intelligence|data science|machine learning|ai (lecturers?|trainers?)|social sciences?|political science)\b/
const OTHER_ACADEMIC_ALL = new RegExp(OTHER_ACADEMIC_TITLE.source, 'g')
const TEACHABLE_TITLE = /\b(english|esl|efl|tefl|tesol|celta|ielts|toeic|toefl|phonics|tieng anh|anh van|anh ngu|conversation|speaking|language|stem|math|maths|mathematics|science|physics|chemistry|biology|steam|robotics|coding|computer science|computing|ict)\b/
const ROLE_WORD_EN = /\b(teachers?|lecturers?|tutors?|instructors?|trainers?|educators?|professors?)\b/
const ROLE_WORD = /\b(teachers?|lecturers?|tutors?|instructors?|trainers?|educators?|professors?|giao vien)\b/
const EMPLOYER_PHRASE = /\b(english|language|foreign language|ielts|esl)( (language|english))? (schools?|centres?|centers?|academy|academies|institutes?|colleges?)\b/g
export function titleNamesOtherSubject(title: string): boolean {
  // The ROLE part only — the part naming the teacher, or the first — and before " at ": an imported listing's title runs
  // on into its employer and place. "Economics Teacher — English Language School" is not an English job (codex, gate
  // 12b), "Hanoi - Economics Teacher" is an Economics one, and "Teacher at Hanoi Law University" may well be English.
  const parts = title.split(/\s+[—–|·]\s+|\s+-\s+/).map(foldPost)
  const role = (parts.find((x) => ROLE_WORD.test(x)) ?? parts[0]).split(/\s(?:at|@)\s/)[0]
  // English or STEM is looked for OUTSIDE the other subject's own words ("Data Science Instructor" is not a Science job —
  // codex + opus, gate 12f) and outside an employer left in the role ("History Teacher, English Language School", 12c).
  return OTHER_ACADEMIC_TITLE.test(role) && !TEACHABLE_TITLE.test(role.replace(OTHER_ACADEMIC_ALL, ' ').replace(EMPLOYER_PHRASE, ' '))
}

/**
 * A TITLE THAT TAKES FOREIGNERS ONLY — "[Expat Only] English Teacher" (graded 2026-10-21), "English Teacher — expat teachers
 * only", "Only foreign teachers": origin by exclusion, refused whole. ⛔ The title only (and a bracket anywhere, in
 * NATIONALITY_ASK): in a post's prose "foreigners only need a passport and a degree" is a visa note, not an ask (opus,
 * gate 12a).
 */
const FOREIGNERS_ONLY_TITLE = /\b(expats?|foreigners?|foreign|non.?vietnamese)( (teachers?|candidates?|applicants?|nationals?))?[ -]only\b|\bonly (expats?|foreigners?|foreign (teachers?|candidates?|applicants?|nationals?)|non.?vietnamese)\b/
export const titleAsksNationality = (title: string): boolean => FOREIGNERS_ONLY_TITLE.test(foldPost(title))

/** Teaching VIETNAMESE (to foreigners): a job for a Vietnamese speaker, not one of eno's teachers'. */
const VIETNAMESE_TEACHING = { test: (t: string) => /\b(vietnamese (language )?(teachers?|tutors?|lessons?|classes?)|teachers? of vietnamese|teach(ing)? vietnamese|learn(ing)? vietnamese|day tieng viet|tieng viet cho nguoi nuoc ngoai)\b/.test(t) && !/\benglish (teachers?|tutors?|classes?|lessons?)\b/.test(t) }

/** A post's opening line that WARNS about an employer ("Beware of this institute …") or SELLS paperwork ("Legal Document
 *  Processing Services …") — each named a teacher or a recruitment site and read as a job, measured on held-out 3. */
const NOT_AN_OFFER_HEAD = /\b(beware|scammers?|scam alert|warning|blacklist(ed)?|fraud(ulent)?)\b|\b(document|legal|visa|work permit|trc|translation|notari[sz]ation|legali[sz]ation)\b[^.!?\n]{0,40}\b(services?|processing|assistance)\b/

/**
 * What a post is. `listing`: the text is a JOB LISTING by construction — a LinkedIn job alert (a title line: "English
 * Teacher · ILA Vietnam · Ho Chi Minh City") or a post the outreach team forwarded as a job — so it needs no hiring words,
 * but every role screen still applies: no teaching role, an assistant or intern role, teaching Vietnamese, an unpaid
 * volunteer post are not jobs here (opus, gate 1b: "Sales Executive" and "Teaching Assistant" alerts went through).
 */
export function readKind(t: string, listing = false): JobKind {
  if (listing) {
    if (!has(withoutAssistants(t), TEACHER_NOUN) || has(t, NON_TEACHING_ROLE) || OTHER_SUBJECT_ONLY(t) || VIETNAMESE_TEACHING.test(t) || (has(t, /\bvolunteer(s|ing)?\b/) && !has(t, /\b(paid|salary|vnd|usd|per hour|\/h|\d+k)\b/))) return 'other'
    return has(t, COVER) ? 'cover_request' : 'job_offer'
  }
  if (has(t.slice(0, 200), NOT_AN_OFFER_HEAD)) return 'other'
  // A job BOARD selling its listings ("Need ESL Teachers? Post a job in 3 minutes starting at $39").
  if (has(t, /\bpost (a|your) (job|vacanc(y|ies))\b/)) return 'other'
  const employer = has(t, EMPLOYER_VOICE)
  if (has(t, SEEKER) && !employer) return 'job_seeker'
  const teacherWord = has(withoutAssistants(t), TEACHER_NOUN)
  if (has(t, ASSISTANT_ONLY) && !teacherWord) return 'other'
  if (has(t, NON_TEACHING_ROLE) && !teacherWord) return 'other'
  if (OTHER_SUBJECT_ONLY(t)) return 'other'
  const teach = has(t, TEACH_ROLE)
  const classWord = has(t, /\b(class|classes|lesson|lessons|students|kids|learners|lop|tiet)\b/)
  const hiring = has(t, HIRING_CUE) || employer
  if (!employer && has(t, DISCUSSION)) return 'other'
  // A hashtag-laden share ("#TeacherCrisis #GlobalEducation …") is news or opinion, not an offer.
  if (!employer && (t.match(/#[a-z0-9_]+/g)?.length ?? 0) >= 3) return 'other'
  // A cover request names its class more often than a teacher ("URGENT cover needed tomorrow 6pm, kids class").
  if (has(t, COVER) && (teach || classWord)) return 'cover_request'
  if (!teach) return 'other'
  // Teaching VIETNAMESE to foreigners is a job for a Vietnamese speaker, not for eno's teachers.
  if (VIETNAMESE_TEACHING.test(t)) return 'other'
  // Unpaid "volunteer" programmes are not jobs.
  if (has(t, /\bvolunteer(s|ing)?\b/) && !has(t, /\b(paid|salary|vnd|usd|per hour|\/h|\d+k)\b/)) return 'other'
  if (hiring) return 'job_offer'
  return 'other'
}


/**
 * The WORK is online — never a bare "online" ("apply online", "our online form"). Measured on the labelled set: a Hanoi
 * centre's "apply online" made an in-person job read as online-only.
 */
const ONLINE_WORK = /\bonline (and |or |\/ ?)?(offline )?(english )?(class|classes|lessons?|teaching|teachers?|tutors?|tutoring|jobs?|positions?|sessions?|courses?|students)\b|\b(teach|teaching|tutoring|classes|lessons) (english )?online\b|\b(via|on|through) (zoom|google meet|teams|skype)\b|\bremote (teaching|job|position|work)\b|\bwork from home\b|\b(day|hoc|lop) truc tuyen\b/

export function readEmployment(t: string, kind: JobKind): Employment[] {
  const out = new Set<Employment>()
  if (kind === 'cover_request') out.add('cover')
  if (has(t, /\bfull.?time\b|\bfulltime\b|\btoan thoi gian\b|\b(12|twelve|6|six|9|nine|10|ten)[ -]month contract\b|\b(monday|mon) (to|-) (friday|fri)\b|\b40 (hours|hrs)\b/)) out.add('full_time')
  if (has(t, /\bpart.?time\b|\bparttime\b|\bban thoi gian\b|\bweekend (classes|only|shifts?)\b|\bevening (classes|shifts?)\b|\b\d{1,2} (hours|hrs|classes|lessons|sessions)( per | a | ?\/ ?)(week|wk)\b/)) out.add('part_time')
  if (has(t, /\bprivate (tutor|tutoring|lessons?|class(es)?|students?)\b|\b1.on.1\b|\bone.on.one\b|\b1 ?- ?1\b|\bgia su\b|\bday kem\b|\btutor for (my|our|a)\b/)) out.add('private')
  if (has(t, ONLINE_WORK)) out.add('online')
  return [...out]
}

export function readPoster(t: string): Poster {
  if (has(t, TEACHER_SWAP)) return 'teacher'
  if (has(t, PARENT)) return 'parent'
  if (has(t, AGENCY)) return 'agency'
  if (has(t, SCHOOL) || has(t, /\bwe('re| are)\b/)) return 'school'
  return 'unknown'
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Places — teach-area keys from the curated tables (places.ts, the explorer's DISTRICTS, vn-units)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `cue`: a short or ambiguous name ("HN", "SG", "Huế", "Vinh" — also people's names) counts only beside a place word. */
type Needle = { re: RegExp; key: string; district: boolean; cue?: RegExp; viaDistrict?: boolean }
const words = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim()
const needle = (spelling: string) => new RegExp(`\\b${words(spelling).replace(/ /g, ' ?')}\\b`)
const cueFor = (spelling: string) => {
  const w = words(spelling)
  return new RegExp(`\\b(in|at|near|tai|o|tp|thanh pho|city of) ${w}\\b|\\b${w} (city|area|based|campus|branch)\\b`)
}

/**
 * HCMC districts: the curated `match` spellings (DISTRICTS — never extended there: the rent index reads them) plus the
 * shorthand posts actually use: "Q7", "Q.7", "D7", "Dist 7", "District7", "quan 7".
 */
const DISTRICT_NEEDLES: Needle[] = DISTRICTS.filter((d) => d.slug !== 'all').flatMap((d) => {
  const out: Needle[] = [...(d.match ?? []), d.nameEn, d.name].map((s) => ({ re: needle(s), key: d.slug, district: true }))
  const n = /^d(\d{1,2})$/.exec(d.slug)?.[1]
  if (n) out.push({ re: new RegExp(`\\b(q|d|dist|district|quan)[ .]?${n}\\b(?!\\s*[/-]?\\s*20\\d\\d)`), key: d.slug, district: true })
  return out
})

/**
 * The 12 hubs (cover.ts COVER_CITIES keys) and the names people type for them — including the districts of cities that
 * have no curated district list (Hanoi, Da Nang): those place a post in the CITY, which is the level a teacher's cover
 * and teach areas hold there. ⛔ "Đi An"/"Thuận An" are left out: folded, "di an" is also "đi ăn" ("go and eat").
 */
const HUB_NEEDLES: Needle[] = ([
  ['ho-chi-minh-city', ['ho chi minh', 'hcmc', 'hcm', 'tp hcm', 'tphcm', 'saigon', 'sai gon'], ['sg'], []],
  ['ha-noi', ['ha noi', 'hanoi'], ['hn'], ['cau giay', 'dong da', 'ba dinh', 'tay ho', 'hai ba trung', 'hoang mai', 'long bien', 'thanh xuan', 'nam tu liem', 'bac tu liem', 'ha dong', 'hoan kiem']],
  ['da-nang', ['da nang', 'danang', 'hoi an', 'quang nam'], [], ['hai chau', 'son tra', 'ngu hanh son', 'thanh khe', 'lien chieu', 'cam le']],
  ['hai-phong', ['hai phong', 'haiphong'], [], []],
  ['can-tho', ['can tho', 'cantho', 'ninh kieu'], [], []],
  ['hue', ['thua thien hue'], ['hue'], []],
  ['khanh-hoa', ['nha trang', 'nhatrang'], [], []],
  ['lam-dong', ['da lat', 'dalat'], [], []],
  ['dong-nai', ['bien hoa', 'dong nai'], [], []],
  ['binh-duong', ['binh duong', 'thu dau mot'], [], []],
  ['vung-tau', ['vung tau', 'ba ria'], [], []],
  ['phu-quoc', ['phu quoc'], [], []],
] as const).flatMap(([key, names, short, districts]) => [
  ...names.map((s) => ({ re: needle(s), key, district: false })),
  ...short.map((s) => ({ re: needle(s), key, district: false, cue: cueFor(s) })),
  // A Hanoi/Da Nang DISTRICT name places a post in that city — unless the post is in an HCMC district: "123 Hai Ba Trung,
  // District 1" is an HCMC street, "Thạnh Xuân, Quận 12" an HCMC ward (opus, gate 1d).
  ...districts.map((s) => ({ re: needle(s), key, district: false, viaDistrict: true })),
])

/** Province names (vn-units, 2025 units) and the towns places.ts aliases — 'p-<code>' keys only for pickable provinces. */
const PROVINCE_NEEDLES: Needle[] = [
  ...VN_PROVINCES.flatMap((p) => {
    const key = provinceKeyOf(p.code)
    return key ? [p.name, p.nameEn].map((s) => ({ re: needle(s), key, district: false })) : []
  }),
  // "Vinh" is also a common given name: a place only beside a place word ("in Vinh", "Vinh city").
  ...TOWN_ALIASES.filter((a) => a.to.startsWith('p-')).flatMap((a) =>
    [a.name, a.nameEn].map((s) => (words(s) === 'vinh' ? { re: needle(s), key: a.to, district: false, cue: cueFor(s) } : { re: needle(s), key: a.to, district: false }))),
  // Pre-2025 provinces people still name, folded into their 2025 unit (places.ts: "Quảng Nam is Đà Nẵng, Bình Định is Gia
  // Lai, Bình Thuận is Lâm Đồng"). Only the pickable ones — a hub province is the hub's chip above.
  ...([['binh dinh', 'p-52'], ['quy nhon', 'p-52'], ['binh thuan', 'p-68'], ['phan thiet', 'p-68'], ['bac giang', 'p-24'], ['vinh phuc', 'p-25'], ['thai binh', 'p-33'], ['nam dinh', 'p-37'], ['ha nam', 'p-37'], ['quang binh', 'p-44'], ['kon tum', 'p-51'], ['phu yen', 'p-66'], ['buon ma thuot', 'p-66'], ['dak nong', 'p-68'], ['long an', 'p-80'], ['tien giang', 'p-82'], ['ben tre', 'p-86'], ['tra vinh', 'p-86'], ['bac lieu', 'p-96'], ['kien giang', 'p-91'], ['rach gia', 'p-91'], ['ha long', 'p-22']] as const)
    .map(([s, key]) => ({ re: needle(s), key, district: false })),
]

/**
 * The teach-area keys a post names. A district implies HCMC (it is never ANOTHER city's "District 1": only HCMC has the
 * curated list, and Hanoi/Da Nang posts name their districts by name, which are not in it). Online when the post is
 * online. `cityOnly` = a city named and no district: a cover request then cannot be placed close enough (facts.ts).
 */
export function readPlaces(t: string): { places: string[]; cityOnly: boolean } {
  // A DISTANCE names a place the work is NOT in: "Que Vo, Bac Ninh (40 mins from Hanoi)", "45km from Hanoi", "10 min from
  // Tay Ho" — measured on the labelled set, each added a wrong city. The words after "from"/"away from" go, and after
  // "to" only behind a km or minutes figure: "teach 2 hours to adults in Thu Duc" is a lesson, not a distance (opus, gate 1b).
  const near = t
    .replace(/\b\d+(\.\d+)?\s*(km|kms|kilometers?|kilometres?|minutes?|mins?|hours?|hrs?|h)\b[^.!?\n()]{0,15}?\b(from|away from)\s+(the\s+)?((?!(in|at|near|and|or|of|inside|within)\b)[a-z]+\s*){1,4}/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(km|kms|kilometers?|kilometres?|minutes?|mins?)\b[^.!?\n()]{0,15}?\bto\s+(the\s+)?((?!(in|at|near|and|or|of|inside|within)\b)[a-z]+\s*){1,4}/g, ' ')
  // A business QUARTER is not District 1–4: "start Q3", "Q1 2027" (opus, gates 1c + 1e) — "in Q1" stays a district.
  const tw = ` ${near.replace(/\b(start|starting|starts|by|until|end of|before|after|early|late|mid|during|next|this|from)\s+q[1-4]\b/g, ' ').replace(/[^a-z0-9]+/g, ' ')} `
  const found = new Set<string>()
  let district = false
  // A name used as a STREET is not the place: "Hai Ba Trung street, District 1" is not Hanoi's Hai Ba Trung district.
  const hit = (n: Needle) => {
    if (n.cue && !n.cue.test(tw)) return false
    for (const m of tw.matchAll(new RegExp(n.re.source, 'g'))) {
      const at = m.index ?? 0
      if (/^\s*(street|st|road|rd|avenue|ave|boulevard|blvd)\b/.test(tw.slice(at + m[0].length)) || /\b(duong|pho|street|st)\s*$/.test(tw.slice(Math.max(0, at - 8), at))) continue
      return true
    }
    return false
  }
  for (const n of DISTRICT_NEEDLES) if (hit(n)) { found.add(n.key); district = true }
  for (const n of HUB_NEEDLES) if (!(n.viaDistrict && district) && hit(n)) found.add(n.key)
  for (const n of PROVINCE_NEEDLES) if (hit(n)) found.add(n.key)
  if (district) found.add(HCMC)
  if (ONLINE_WORK.test(tw)) found.add(ONLINE)
  // `cityOnly` is about HCMC alone: it is the one city with a district list, so a whole-city HCMC cover request can be
  // anywhere across a 2,000 km² city — elsewhere the city IS the finest level a teacher's cover area holds.
  return { places: [...found], cityOnly: found.has(HCMC) && !district }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pay
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const UNIT_WORD: [RegExp, PayUnit][] = [
  [/^ ?(\/|per |a |an |each |mot |1 )?(h|hr|hrs|hour|hours|gio|tieng|60 ?(min|mins|minutes|phut))\b/, 'hour'],
  [/^ ?(\/|per |a |an |each |mot |1 )?(session|sessions|class|classes|lesson|lessons|buoi|tiet|ca|slot|shift|90 ?(min|mins|minutes|phut)|45 ?(min|mins|minutes|phut))\b/, 'session'],
  [/^ ?(\/|per |a |an |each |mot )?(day|ngay)\b/, 'day'],
  [/^ ?(\/|per |a |an |each |mot )?(month|months|mo|thang|net\/month|gross\/month)\b/, 'month'],
]

/**
 * The first pay figure a post states, as whole VND per unit. Understood: "400k/h", "350-450k per hour", "400.000đ/giờ",
 * "500k/buổi", "$20/hour", "25-30 million", "25tr-35tr", "25 - 35 triệu/tháng", "1,200-1,800 USD/month", "30M VND".
 * ⚠️ Unit-less figures are guessed by size — ≥ 5 million VND (or ≥ 500 USD) reads as a MONTH, ≤ 2 million as an HOUR —
 * and anything in between, or anything unparseable, is `unknown` (no pay gate runs on it: gates.ts).
 */
export function readPay(t: string): Pay | null {
  // money tokens: number (with . or , grouping, optional decimal) + magnitude suffix + optional currency
  const re = /(\$ ?|usd ?)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?) ?(millions|million|mil(?![a-z])|m(?![a-z0-9²])|trieu|tr(?![a-z])|thousand|nghin|ngan|k(?![a-z]))?( ?(vnd|vnđ|dong|d\b|usd|\$))?(\s*(-|~|to|den)\s*(\$ ?|usd ?)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?) ?(millions|million|mil(?![a-z])|m(?![a-z0-9²])|trieu|tr(?![a-z])|thousand|nghin|ngan|k(?![a-z]))?( ?(vnd|vnđ|dong|d\b|usd|\$))?)?/g
  const cue = /\b(salary|pay|paid|rate|wage|luong|thu nhap|muc luong|offer|compensation|vnd|usd|per hour|\/h|\/hour|million|trieu|tr\b|k\/)/
  for (const m of t.matchAll(re)) {
    const [whole] = m
    const at = m.index ?? 0
    const around = t.slice(Math.max(0, at - 40), at + whole.length + 40)
    // groups: 1 $ · 2 number · 3 magnitude · 4/5 currency · 6 range · 7 separator · 8 $ · 9 number · 10 magnitude · 11/12 currency.
    // A range's magnitude/currency may sit on either end ("25-30 million", "25tr-35tr", "1,200-1,800 USD").
    const usd = !!(m[1] || m[8] || /usd|\$/.test(`${m[5] ?? ''}${m[12] ?? ''}`)) // m[1]/m[8]: "$" or "USD" before the figure
    const mag1 = m[3] ?? m[10] ?? ''
    const mag2 = m[10] ?? m[3] ?? ''
    const a = num(m[2], mag1, usd)
    const b = m[7] ? num(m[9], mag2, usd) : a
    if (a === null || b === null) continue
    // A figure that starts with 0 ("090.123.4567") is a phone, never money (opus, gate 1d).
    if (/^0\d/.test(m[2] ?? '') || (m[9] && /^0\d/.test(m[9]))) continue
    // A bare small number with no currency, magnitude or pay cue nearby is a time, an age, a count — never pay.
    if (!usd && !mag1 && !mag2 && !/vnd|vnđ|dong|\bd\b/.test(whole) && !cue.test(around)) continue
    if (a < 10_000 && !usd) continue
    const after = t.slice(at + whole.length, at + whole.length + 24)
    // A bare "m" is also metres ("200m from Vincom", "2m from the gate" — opus, gate 1b, each read as millions): it is
    // pay only with a pay word just before it or a pay unit just after, and never before a distance word.
    if ((mag1 === 'm' || mag2 === 'm') && !usd && !/vnd|vnđ|dong|\bd\b/.test(whole)) {
      if (/^\s*(from|away|to|walk|walking|far|distance|x\b|\*)/.test(after)) continue
      const payBefore = /\b(salary|pay|paid|rate|wage|luong|thu nhap|muc luong|offer|compensation|income|package|earn)\b[^.!?\n]{0,15}$/.test(t.slice(Math.max(0, at - 30), at))
      if (!payBefore && !UNIT_WORD.some(([u, name]) => name !== 'session' && u.test(after))) continue
    }
    let unit: PayUnit = 'unknown'
    for (const [u, name] of UNIT_WORD) if (u.test(after)) { unit = name; break }
    const lo = Math.min(a, b), hi = Math.max(a, b)
    if (unit === 'unknown') unit = hi >= 5_000_000 ? 'month' : hi <= 2_000_000 && hi >= 50_000 ? 'hour' : 'unknown'
    if (unit === 'unknown') continue
    // Sanity per unit: a figure outside the market is a misread (a phone fragment, a year, a code).
    const ok = unit === 'month' ? hi >= 3_000_000 && hi <= 300_000_000 : unit === 'day' ? hi >= 100_000 && hi <= 10_000_000 : hi >= 50_000 && hi <= 5_000_000
    if (!ok) continue
    return { min: lo, max: hi, unit, text: whole.trim().slice(0, 40) }
  }
  return null
}

function num(raw: string | undefined, mag: string, usd: boolean): number | null {
  if (!raw) return null
  // "1.200.000" / "1,200,000" = grouping; "1.5" / "1,5" = a decimal (triệu/million follow it)
  const grouped = /^\d{1,3}([.,]\d{3})+$/.test(raw)
  const n = grouped ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  const m = /^(tr|trieu|m|mil|million|millions)$/.test(mag) ? 1_000_000 : /^(k|nghin|ngan|thousand)$/.test(mag) ? 1_000 : 1
  const v = n * m
  return Math.round(usd ? v * USD_VND : v)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Schedule (cover requests)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const DAY_WORDS: [RegExp, number][] = [
  [/\b(sunday|chu nhat)\b|\bsun\b(?=\s*(-|to|,|\d|\/|morning|afternoon|evening|night|am\b|pm\b))|\bcn\b(?! (degree|bang|nganh|su pham))/, 0], [/\b(monday|thu 2|thu hai|t2)\b|\bmon\b(?=\s*(-|to|,|\d|\/|morning|afternoon|evening|night|am\b|pm\b))/, 1], [/\b(tuesday|tues?|thu 3|thu ba|t3)\b/, 2],
  [/\b(wednesday|wed|thu 4|thu tu|t4)\b/, 3], [/\b(thursday|thurs?|thu 5|thu nam|t5)\b/, 4], [/\b(friday|fri|thu 6|thu sau|t6)\b/, 5],
  [/\b(saturday|thu 7|thu bay|t7)\b|\bsat\b(?! (class|classes|prep|preparation|tutor|tutoring|tutors|math|maths|reading|writing|exam|exams|test|tests|score|scores|teacher|teachers|course|courses|verbal|program))/, 6],
]
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_WORD = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)'

/** The Vietnam calendar date of `d` (UTC+7, no DST). */
function vnDate(d: Date): { y: number; m: number; day: number; dow: number } {
  const v = new Date(d.getTime() + 7 * 3_600_000)
  return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, day: v.getUTCDate(), dow: v.getUTCDay() }
}
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
function addDays(y: number, m: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, day: t.getUTCDate(), dow: t.getUTCDay() }
}

/**
 * When a cover request is for: a date ("25/10", "Oct 25", "today", "tonight", "tomorrow", a weekday — the next one on or
 * after the post day) and a part of the day from a time ("6pm", "18:00", "8h-10h") or a word (morning/afternoon/evening,
 * sáng/chiều/tối). Relative words are read against `postedAt` in Vietnam time. Null when neither is stated.
 */
export function readSchedule(t: string, postedAt: Date): Schedule | null {
  const base = vnDate(postedAt)
  // A cover is for a day from the post day to six weeks out: "2/3 classes" is not 2 March, "24/7" not 24 July (opus, gate
  // 1a), and an earlier date in the text ("Posted 19/10 · cover needed tomorrow" — codex, gate 1c) is not the lesson.
  const baseDay = Date.UTC(base.y, base.m - 1, base.day)
  const plausible = (d: Date) => d.getTime() >= baseDay && d.getTime() <= baseDay + 42 * 86_400_000
  // With no year, the year that puts the date in that window ("30/12" read on 2 January is last year's — opus, gate 1c).
  const dated = (y0: number | null, mo: number, d: number) => {
    for (const y of y0 !== null ? [y0] : [base.y, base.y + 1, base.y - 1]) {
      const probe = new Date(Date.UTC(y, mo - 1, d))
      if (probe.getUTCMonth() === mo - 1 && plausible(probe)) return { y, m: mo, day: d, dow: probe.getUTCDay() }
    }
    return null
  }
  let date: { y: number; m: number; day: number; dow: number } | null = null
  // "25/10", "25/10/2026", "25.10.2026" — never "6-7:30pm" or "8.30" (a time), so '-' is not a separator and '.' needs a year.
  // Every explicit date in turn, the first that can be the lesson: never a grade or a fraction ("grade 10/11 class",
  // "2/3 classes"), never the date the post was written ("Posted 21/10 · cover needed 22/10" — codex, gate 1d).
  for (const dm of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b(?! ?(?::|am|pm|h\b))(?!\s*(?:class|classes|lessons?|students|kids|sessions?|days|weeks|hours|times|people|teachers|support|service)\b)|\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g)) {
    if (/^24\/7$/.test(dm[0])) continue
    const before = t.slice(Math.max(0, (dm.index ?? 0) - 16), dm.index)
    if (/\b(grades?|lop|level|year|unit|book|class|posted|updated|published|dang ngay|dang)\s*:?\s*(on\s*)?$/.test(before)) continue
    const d = Number(dm[1] ?? dm[4]), mo = Number(dm[2] ?? dm[5])
    const yy = dm[3] ?? dm[6]
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) date = dated(yy ? Number(yy.length === 2 ? `20${yy}` : yy) : null, mo, d)
    if (date) break
  }
  if (!date) {
    // The month's name or its abbreviation, never a word that starts like one ("novice 5 students" — opus, gate 1c).
    const md = new RegExp(`\\b${MONTH_WORD}\\.? (\\d{1,2})(st|nd|rd|th)?\\b|\\b(\\d{1,2})(st|nd|rd|th)? ${MONTH_WORD}\\b`).exec(t)
    if (md) {
      const mo = MONTHS.indexOf((md[1] ?? md[6]).slice(0, 3)) + 1
      const d = Number(md[2] ?? md[4])
      if (d >= 1) date = dated(null, mo, d)
    }
  }
  if (!date) {
    if (/\b(today|tonight|this (morning|afternoon|evening)|hom nay|toi nay|chieu nay|sang nay)\b/.test(t)) date = base
    else if (/\b(tomorrow|tmr|tmrw|ngay mai)\b/.test(t)) date = addDays(base.y, base.m, base.day, 1)
    else {
      // The weekday named FIRST in the text ("Saturday or Sunday" is Saturday — opus, gate 1c), not the first in the list.
      let first: { at: number; dow: number } | null = null
      for (const [re, dow] of DAY_WORDS) {
        const m = re.exec(t)
        if (m && (!first || m.index < first.at)) first = { at: m.index, dow }
      }
      if (first) date = addDays(base.y, base.m, base.day, (first.dow - base.dow + 7) % 7)
    }
  }
  const { part, hour } = readTime(t)
  if (!date && !part) return null
  const day = date ? DAYS[date.dow] : null
  const dayLabel = date ? `${DAYS[date.dow].charAt(0).toUpperCase()}${DAYS[date.dow].slice(1)} ${date.day} ${MONTHS[date.m - 1].charAt(0).toUpperCase()}${MONTHS[date.m - 1].slice(1)}` : ''
  const partLabel = part === 'am' ? 'morning' : part === 'pm' ? 'afternoon' : part === 'eve' ? 'evening' : ''
  return { date: date ? iso(date.y, date.m, date.day) : null, day, part, hour, label: [dayLabel, partLabel].filter(Boolean).join(', ') }
}

/** A part-of-day word right after a time is its meridiem: "7h tối" / "7 in the evening" is 19:00 (opus, gate 2d). */
function meridiemAfter(t: string, at: number): 'am' | 'pm' | undefined {
  const next = t.slice(at, at + 16)
  if (/^\s*(toi\b(?!\s*\d)|chieu|in the (evening|afternoon)|at night|tonight|this (evening|afternoon))\b/.test(next)) return 'pm'
  if (/^\s*(sang|in the morning|this morning)\b/.test(next)) return 'am'
  return undefined
}

function readTime(t: string): { part: 'am' | 'pm' | 'eve' | null; hour: number | null } {
  const partOf = (h: number): 'am' | 'pm' | 'eve' | null => (h >= 6 && h < 12 ? 'am' : h >= 12 && h < 17 ? 'pm' : h >= 17 && h <= 21 ? 'eve' : null)
  // A RANGE takes its meridiem from either end ("7:30–8:30 PM", "6pm-7:30") — measured: "7:30–8:30 PM tonight" was
  // read as a morning from its first number.
  // "từ 7h tới 9h sáng" — folded "tới" (to) is "toi", a separator here, never "tối" (opus, gate 3b).
  const range = /\b(\d{1,2})(?::(\d{2})|h(\d{2})?)?\s*(am|pm)?\s*(?:-|to|den|toi)\s*(\d{1,2})(?::(\d{2})|h(\d{2})?)?\s*(am|pm)?\b/.exec(t)
  if (range && (range[2] !== undefined || range[3] !== undefined || range[6] !== undefined || range[7] !== undefined || range[4] || range[8])) {
    const ap = range[4] || range[8] || meridiemAfter(t, (range.index ?? 0) + range[0].length)
    let h = Number(range[1])
    if (h <= 23) {
      if (ap === 'pm' && h < 12) h += 12
      else if (!ap && h >= 1 && h <= 6) h += 12 // no school teaches English at 5:45 in the morning
      const p = partOf(h)
      if (p) return { part: p, hour: h }
    }
  }
  // A single clock time: "18:00", "6pm", "6:30 pm", "8h30".
  for (const m of t.matchAll(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?)? ?(am|pm|a\.m\.|p\.m\.)?\b/g)) {
    const raw = m[0]
    // A bare number is not a time — unless "at 7 in the evening" says so.
    if (!/[:h]|am|pm/.test(raw) && !(meridiemAfter(t, (m.index ?? 0) + raw.length) && /\b(at|luc)\s*$/.test(t.slice(Math.max(0, (m.index ?? 0) - 6), m.index)))) continue
    // "Posted at 09:00 · cover needed 18:00" — the time the post was written is not the lesson's (codex, gate 1d).
    if (/\b(posted|updated|published|dang)( at| luc)?\s*$/.test(t.slice(Math.max(0, (m.index ?? 0) - 14), m.index))) continue
    // "2h class", "a 2h lesson" — a duration: a bare "Nh" is a clock time only after "at/from/lúc/từ/starts".
    if (/^\d{1,2}h$/.test(raw.trim()) && !/\b(at|from|luc|tu|starts?|starting|bat dau|vao)\s*$/.test(t.slice(Math.max(0, (m.index ?? 0) - 14), m.index))) continue
    let h = Number(m[1])
    if (h > 23) continue
    const ap = m[4]?.replace(/\./g, '') || meridiemAfter(t, (m.index ?? 0) + raw.length)
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (!ap && h >= 1 && h <= 6) h += 12
    const p = partOf(h)
    if (p) return { part: p, hour: h }
  }
  const word = (part: 'am' | 'pm' | 'eve') => ({ part, hour: null })
  if (/\b(tonight|this evening|toi nay|buoi toi)\b/.test(t)) return word('eve')
  if (/\b(this afternoon|chieu nay|buoi chieu)\b/.test(t)) return word('pm')
  if (/\b(this morning|sang nay|buoi sang)\b/.test(t)) return word('am')
  // ⚠️ Folded, "tôi" (I) is "toi" (tối, evening) — "tôi cần gấp" read as an evening (opus, gate 1a). The Vietnamese
  // words count only in a time-of-day phrase.
  const VI_PART = (w: string) => new RegExp(`\\b(buoi|ca|lop|vao|day|hoc) ${w}\\b|\\b${w} (thu|t[2-7]|cn|chu nhat|\\d)`)
  if (/\bmorning\b/.test(t) || VI_PART('sang').test(t)) return word('am')
  if (/\bafternoon\b/.test(t) || VI_PART('chieu').test(t)) return word('pm')
  if (/\b(evening|night)\b/.test(t) || VI_PART('toi').test(t)) return word('eve')
  return { part: null, hour: null }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Requirements, ages, subjects
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const PREFERRED = /\b(preferred|prefered|preferabl[ey]|a plus|is a plus|an advantage|advantageous|nice to have|bonus|desirable|ideally|uu tien)\b/g
const REQUIRED = /\b(required|requirements?|must|mandatory|essential|necessary|needed|need to|have to|bat buoc|yeu cau)\b/g
/**
 * The clause a match sits in: a sentence, a list item ("- ", "•", "1/", a comma), or a line — never the whole post.
 * ⚠️ A comma ends a clause, so "Degree, TEFL and experience preferred" reads the degree as REQUIRED: in a list that
 * does not say, the stricter reading only holds a job back from a teacher, while the looser one sends it to one who
 * lacks what it asks for.
 */
const CLAUSE_BREAK = /[.,!?;\n•*✓✔➤►]|\s[-–]\s|\s\d[/)]\s/g
function clauseAround(t: string, at: number, end: number): [number, number] {
  let from = 0, to = t.length
  for (const b of t.matchAll(CLAUSE_BREAK)) {
    const i = b.index ?? 0
    if (i < at) from = i + b[0].length
    else if (i >= end) { to = i; break }
  }
  return [from, to]
}
/**
 * Whether the post REQUIRES, PREFERS or does not mention something. Every mention counts and a required one wins:
 * "Native speakers preferred … native English teachers only" is required. A mention is 'preferred' only when a
 * preference word sits in the SAME clause and nearer to it than any requirement word — measured (codex, gate 1a):
 * a ±60-character window read "Native English speaker required. TEFL preferred." as native preferred.
 */
function need(t: string, re: RegExp): Need {
  let out: Need = 'none'
  for (const m of t.matchAll(new RegExp(re.source, 'g'))) {
    const at = m.index ?? 0, end = at + m[0].length
    const [from, to] = clauseAround(t, at, end)
    const dist = (w: RegExp) => {
      let best = Infinity
      for (const x of t.slice(from, to).matchAll(w)) {
        const i = from + (x.index ?? 0), j = i + x[0].length
        best = Math.min(best, j <= at ? at - j : i >= end ? i - end : 0)
      }
      return best
    }
    // "TEFL not required", "no degree needed", "without a degree" (codex, gate 1b) and "we provide free TEFL training"
    // (opus) say the post does NOT ask for it: that mention counts for nothing.
    const before = t.slice(Math.max(0, at - 40), at), after = t.slice(end, end + 40)
    if (NEGATED_BEFORE.test(before) || NEGATED_AFTER.test(after) || PROVIDED_BEFORE.test(before) || PROVIDED_AFTER.test(after)) continue
    const pref = dist(PREFERRED), req = dist(REQUIRED)
    if (pref < Infinity && pref < req) out = out === 'required' ? 'required' : 'preferred'
    else return 'required'
  }
  return out
}
const NEGATED_BEFORE = /\b(no|not|without|never|don'?t need|do not need|doesn'?t need|does not need|no need (for|of|to have)|khong can|khong yeu cau|khong bat buoc)\s+(an? |any |the )?$/
const NEGATED_AFTER = /^\s*(is |are )?(:\s*)?(not|isn'?t|aren'?t|no longer)\s+(required|necessary|needed|a must|mandatory|compulsory|essential|a requirement)\b|^\s*(:\s*)?(not required|not necessary|not needed|optional)\b/
const PROVIDED_BEFORE = /\b(provide|provides|provided|offer|offers|offering|free|sponsor|sponsors|sponsored|pay for|pays for|cover|covers|help (you )?(get|obtain)|support (you )?(to get|getting|with))\s+(you |your |our |a |an |the |free )?(own )?$/
const PROVIDED_AFTER = /^\s*(training|course|courses|certification course|program|programme)?\s*(is |are |will be )?(provided|offered|available|included|sponsored|supported|paid for|for free)\b/

export function readRequirements(t: string): Requirements {
  // ⚠️ 80 % of eno's teachers are not native speakers, so a "native required" read wrongly withholds the post from most of
  // them. Measured on held-out 3 (2026-10-20): 10 of 33 "required" were inclusive — "native/non-native", "ESL or native
  // English teacher", "native speaker not required", "(non-native speakers)" — so ANY mention of non-natives, other than
  // shutting them out, means the post takes them.
  // ⚠️ …but "non-native candidates will not be considered" mentions them to shut them out (codex, gate 1c).
  const nonNativeShut = /\bno non[-\s]{0,2}natives?\b|\bnon[-\s]{0,2}natives?\b[^.!?;\n]{0,30}\b(not|cannot|can'?t|won'?t|need not|needn'?t|don'?t|do not|aren'?t|is not|isn'?t)\b[^.!?;\n]{0,20}\b(apply|accepted|considered|eligible|welcome|suitable)\b|\bnatives? (english )?(speakers? |teachers? )?only\b/.test(t)
  const nonNativeOk = !nonNativeShut && ((/\bnon[-\s]{0,2}natives?\b/.test(t))
    || /\b(no need|don't need|do not need|not necessarily|needn'?t) (to be )?(a )?native\b|\bnative (english )?(speakers?|teachers?|level|english teachers?)? ?(is |are )?not (required|necessary|needed|a must|compulsory|mandatory)\b/.test(t)
    || /\b(esl|efl|filipinos?|vietnamese|local|asian|any)( english)?( teachers?)?\s*(or|\/|&)\s*native\b|\bnative( english)?( speakers?| teachers?)?\s*(or|\/)\s*(an? )?(vietnamese|local|filipinos?|esl|efl|near.?native|fluent)\b/.test(t))
  const native: Need = nonNativeOk ? 'none' : need(t, /(?<!\bnon[-\s]{0,2})\bnative (english )?(speakers?|teachers?|only|level|required|english teachers?)\b|\bmust be (a )?native\b|\b(giao vien|gv) ban (ngu|xu)\b|\bban ngu\b/)
  const degree = need(t, /\b(bachelor'?s?|ba|bs|bsc|university|college|uni) (degree|graduate)\b|\bdegree (holders?|is required|required|in any|needed)\b|\b(a|any) degree\b|\bbang (cu nhan|dai hoc)\b|\btot nghiep dai hoc\b/)
  const tefl = need(t, /\b(tefl|tesol|celta|delta|tkt|pgce|teaching (certificate|certification|license|licence|qualification))\b|\bchung chi (tefl|tesol|celta|su pham|giang day)\b/)
  const y = /\b(?:at least |min(?:imum)?\.? |over |more than )?(\d{1,2})\+? ?(?:years?|yrs?|nam)(?:'?s?)? (?:of )?(?:teaching |working |relevant |esl |english teaching )?(?:experience|exp|kinh nghiem)\b/.exec(t)
  const minYears = y ? Math.min(20, Number(y[1])) : null
  const inVietnam = /\b(must|need to|should|have to) (be|currently be|already be) (currently |already )?(based |living |located |residing )?in (vietnam|viet nam|vn|hcmc|saigon|hanoi|ha noi|da nang)\b|\bcurrently (living|based|residing|located) in (vietnam|viet nam|vn)\b|\b(in.?country|local) (applicants|candidates) only\b|\bonly (applicants|candidates) (currently )?in (vietnam|vn)\b|\b(dang )?(o|song tai) viet nam\b/.test(t)
  const abroadOk = /\b(overseas|abroad|international|offshore) (applicants|candidates|teachers) (are )?(welcome|considered|accepted|can apply)\b|\b(relocation|flight) (support|package|allowance|reimbursement|assistance)\b|\bapply from (abroad|overseas|home)\b/.test(t)
  return { native, degree, tefl, minYears, inVietnam, abroadOk }
}

export function readAgeGroups(t: string): ('kids' | 'teens' | 'adults')[] {
  const out: ('kids' | 'teens' | 'adults')[] = []
  if (/\b(kids?|kindy|kindergarten|preschool|pre-school|young learners?|primary|children|toddlers?|mam non|mau giao|tieu hoc|thieu nhi|tre em)\b|\b(cac|day|cho|lop|nhom|em|con|be) be\b|\bbe (tu|lop|mam non|mau giao|\d)/.test(t)) out.push('kids')
  if (/\b(teens?|teenagers?|secondary|high school|middle school|junior high|thcs|thpt|trung hoc)\b/.test(t)) out.push('teens')
  if (/\b(adults?|university students|working professionals|corporate|in.?company|business english|nguoi lon|nguoi di lam|sinh vien)\b/.test(t)) out.push('adults')
  return out
}

/** Subject keys of the teacher taxonomy (profile.ts SUBJECTS): only those a post names outright. */
export function readSubjects(t: string): string[] {
  const out: string[] = []
  if (/\bielts\b/.test(t)) out.push('ielts')
  if (/\b(toeic|toefl)\b/.test(t)) out.push('toefl-toeic')
  if (/\bcambridge\b|\b(starters|movers|flyers|ket|pet|fce|cae)\b/.test(t)) out.push('cambridge')
  if (/\bphonics\b/.test(t)) out.push('phonics')
  if (/\bbusiness english\b|\bcorporate (english|classes|training)\b/.test(t)) out.push('business-english')
  if (/\b(stem|math|maths|mathematics|science|physics|chemistry|biology|steam|robotics|coding|computer science|computing|ict)\b/.test(t)) out.push('stem')
  if (/\b(english|esl|efl|tieng anh|anh van|communication|conversation|speaking)\b/.test(t)) out.push('general-english')
  if (readLanguages(t).length) out.push('other-language')
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The whole reading
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "không cần bản ngữ" (native not needed) is the opposite of a foreigner cue (opus, gate 1d): negated cues go first. */
const withoutNegatedCues = (t: string) =>
  t.replace(/\b(khong can|khong yeu cau|khong bat buoc|khong nhat thiet|ko can|k can)\s+(la\s+)?(giao vien |gv )?(nguoi )?(ban ngu|ban xu|nuoc ngoai|native)\b/g, ' ')

/**
 * A post written in Vietnamese is for a FOREIGN teacher only with a cue saying so (eno's linked-jobs rule, exportJobs
 * foreignerOriented: "giáo viên nước ngoài", "bản ngữ", native, foreigner, expat, Tây) — most Vietnamese-language
 * posts in these groups recruit Vietnamese teachers and teaching assistants (trợ giảng), and no eno teacher is one.
 * ⚠️ "nước ngoài" alone is not a cue ("dạy tiếng Việt cho người nước ngoài") — it must sit next to a teacher word.
 */
// "Foreign Language Center" is a school's name, not a cue (codex, gates 12d, 12e)
const FOREIGNER_CUE = /\b(giao vien|gv|thay|co) (nuoc ngoai|ban ngu|ban xu|tay|philippines|phi)\b|\b(nguoi )?ban ngu\b|\bnative\b|\bforeign(er|ers)?\b(?![ -]languages?\b)|\bexpats?\b|\bnguoi nuoc ngoai (day|giang day)\b/
export function vietnameseWithoutForeignerCue(text: string): boolean {
  const t = withoutNegatedCues(foldPost(text))
  if (!writtenInVietnamese(text, t)) return false
  return !FOREIGNER_CUE.test(t)
}

/**
 * A LINKEDIN JOB TITLED IN VIETNAMESE ONLY — "Giáo Viên IELTS Fulltime Từ 7.5" (2026-10-21). Its text is nothing but
 * "title · company · place" (eno-job-mailbox.py), too short for writtenInVietnamese's measure once a place is one word,
 * so its title's language is the post's. Not with an English role word ("Giáo viên bản ngữ / Native English Teacher") or
 * a foreigner cue IN THE TITLE ("Giáo viên nước ngoài") — the company's name is not one ("Foreign Language Center", codex,
 * gate 12d). Only there: a post with a body is measured by it (writtenInVietnamese) — "Giáo viên tiếng Anh" over an
 * English description is not for Vietnamese teachers (opus, gate 12c).
 */
const VI_ROLE = /\b(giao vien|giang vien|tro giang|gv)\b/
const titleIsVietnameseOnly = (title: string): boolean => {
  const t = withoutNegatedCues(foldPost(title))
  return VI_ROLE.test(t) && !ROLE_WORD_EN.test(t) && !FOREIGNER_CUE.test(t)
}

/**
 * Whether a post is WRITTEN in Vietnamese: by its accents (NFC first — a decomposed "ế" is two code points, opus, gate
 * 1a), or, typed without accents ("Trung tam tuyen giao vien tieng Anh tai Quan 7, luong 8 trieu" — codex, gate 1a), by
 * how many of its words are Vietnamese-only. ⚠️ The word list leaves out English look-alikes (can, day, gap, so) and
 * the syllables that are mostly places (quan, hoc, cau, lam, tien …), and a place name is ONE word (PLACE_NAMES, below),
 * so an English post naming "Quan 7", "Hoc Mon" or "Ho Chi Minh City" is not one.
 */
const VI_ONLY_WORDS = new Set('tuyen giao vien luong trieu lop nguoi duoc khong nhung cua voi lien thoi gian yeu kinh nghiem uu sinh truong ngay thang buoi chieu viec tieng nhan hoac cac mot nhieu hien tai dia gio tuan tro giang dang ky ung muon minh chung chi bang cap ho so phu huynh'.split(' '))
/**
 * ⛔ A PLACE NAME IS ONE WORD, NOT ITS SYLLABLES. The word list needs họ, chỉ, mình, phụ huynh, trợ giảng, liên hệ,
 * buổi chiều — ho, chi, minh, phu, giang, lien, chieu folded — and those are also the syllables of Ho Chi Minh City, Phu
 * Nhuan, Kien Giang, Lien Chieu, so every "Ho Chi Minh" counted as THREE Vietnamese words: "English teachers wanted …
 * GEMS - Ho Chi Minh City, Vietnam … Public Schools in Ho Chi Minh City, Vietnam" (held-out 4, n=3006) had six and was
 * dropped, and so were four English jobs of the first LinkedIn alert (2026-10-21 — with run.ts reading each field twice).
 * A place the place reader knows (districts, hubs, provinces — not a short name that needs a place word beside it: "SG",
 * "Huế", "Vinh"), matched as it matches them, now counts once: a Vietnamese-only word if a syllable of it is one, else
 * an ordinary word. The accents are measured as before.
 */
const PLACE_NAMES: RegExp[] = [...DISTRICT_NEEDLES, ...HUB_NEEDLES, ...PROVINCE_NEEDLES]
  .filter((n) => !n.cue)
  .map((n) => new RegExp(n.re.source, n.re.flags.includes('g') ? n.re.flags : `${n.re.flags}g`))

function writtenInVietnamese(text: string, folded: string): boolean {
  const nfc = text.normalize('NFC')
  const marks = (nfc.match(/[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/gi) ?? []).length
  const letters = (nfc.match(/\p{L}/gu) ?? []).length
  if (letters && marks / letters >= 0.06) return true
  let rest = ` ${folded.replace(/[^a-z0-9]+/g, ' ')} `
  let places = 0
  let viPlaces = 0
  for (const re of PLACE_NAMES) {
    rest = rest.replace(re, (name) => {
      places++
      if (name.split(' ').some((w) => VI_ONLY_WORDS.has(w))) viPlaces++
      return ' '
    })
  }
  const tokens = rest.match(/[a-z]+/g) ?? []
  const vi = tokens.filter((w) => VI_ONLY_WORDS.has(w)).length + viPlaces
  return vi >= 4 && vi / (tokens.length + places) >= 0.2
}

/** Read every fact a rule can state. `postedAt` anchors "tomorrow"/"Saturday" for cover requests; `listing` — see readKind. */
export function readPost(text: string, postedAt: Date, opts: { listing?: boolean; title?: string | null; fieldsOnly?: boolean } = {}): RuleFacts {
  const t = foldPost(text)
  // `title`: the job's own title (a listing's, a LinkedIn job's) — what the role IS (titleNamesOtherSubject).
  // `fieldsOnly`: the text is only the job's fields, no body — a LinkedIn job (titleIsVietnameseOnly).
  const kind = opts.title && titleNamesOtherSubject(opts.title) ? 'other' : readKind(t, opts.listing ?? false)
  const { places, cityOnly } = readPlaces(t)
  let deny = denyReason(text) ?? (opts.title && titleAsksNationality(opts.title) ? 'nationality' : null)
  // eno.vn carries no visa wording (licensing split). A post that is ONLY about visas/work permits — no teaching job
  // in it — is not a job. A teaching job that ALSO mentions permit support stays: the message never quotes the post,
  // and its own words pass isVisaWorded (compose.ts).
  if (!deny && isVisaWorded(text) && kind === 'other') deny = 'visa-only'
  if (!deny && vietnameseWithoutForeignerCue(text)) deny = 'vietnamese-oriented'
  if (!deny && opts.fieldsOnly && opts.title && titleIsVietnameseOnly(opts.title)) deny = 'vietnamese-oriented'
  return {
    version: RULES_VERSION,
    kind,
    employment: readEmployment(t, kind),
    poster: readPoster(t),
    places,
    cityOnly,
    pay: readPay(t),
    schedule: kind === 'cover_request' ? readSchedule(t, postedAt) : null,
    ageGroups: readAgeGroups(t),
    subjects: readSubjects(t),
    languages: readLanguages(t),
    requirements: readRequirements(t),
    deny,
    mention: deny ? null : demographicMention(t),
  }
}
