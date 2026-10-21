import { assertCleanContactName, assertCleanTexts, containsContactInfo, findBannedWord, PublishBlockedError, type PublishBlockCode } from '@/lib/publish-guard'
import { containsPhoneNumber } from '@/lib/phone'
import { teacherVisaMention } from '@/lib/teachers/visa-mention'
import { trippingWords } from '@/lib/tripping-words'

/**
 * ⛔ THE ONE DECISION ON A TEACHER'S OWN TEXT — the publish core (publish.ts screenTeacherTexts), the CV import
 * (import-map.ts importTextRefused) and the form (teacher-form-rules.ts checkSteps, steps/shared.tsx) all ask HERE, so
 * the three can never disagree. Pure, and client-safe: the browser runs it to show the teacher their own words.
 *
 * Owner, 2026-10-21, a teacher in Hội An: "My description … is being repeatedly blocked … 'contains a word we do not allow',
 * but I am unable to know which word … Can the site admins please inform me what word is not allowed?" — three refused
 * Publishes, then his complaint published as his bio. THE FAULT WAS THAT THE WORD WAS NEVER SHOWN: the server names only
 * the FIELD (still — nothing new on the wire), and the form now finds the teacher's own words in that field
 * (teacherRefusedWords) and prints them under it. A refusal the teacher thinks wrong — "we can chat no problem" read as
 * "chất nổ", "the cao lau" as "thẻ cào lậu", "escort students on trips", "bạn đam mê" as "bán dâm" (the 2026-10-21 sweep
 * found 39 such readings in ordinary teacher text) — becomes a rewording, not a dead end; a NAME gets the human route.
 * ⚠️ A visa word quoted back is the teacher's OWN text, shown to them alone — the text their own field already shows.
 * eno.vn's copy names no rule and no word. Precedent on eno.vn since 2026-10-18: the post wizard quotes a job poster's
 * own visa/TRC words back to them ("Remove or reword this part: “…”", post-wizard.tsx jobTextNote; the server even
 * sends that snippet) — here nothing new goes on the wire at all.
 *
 * ⛔ THE DECISION ITSELF IS THE ONE IT WAS — publish-guard's own assertCleanContactName / assertCleanTexts (a phone,
 * contact details, the banned list on the folded letters), then the visa screen, on every field. Two commit-gate rounds
 * (codex + opus, 2026-10-21) found each narrowing tried here — exempt terms, names unscreened, an accent-aware reading,
 * a word-by-word "thị thực" — opening a publishable path ("I sell heroin", "ban ma tuy", a name "Visa Help Vietnam",
 * "xin thi thuc ra sao", "thị thức", "ビザン申請"). NO reading changed: what was refused is refused; it is now SHOWN.
 */

export type TeacherTextCode = 'contact_in_text' | 'contact_in_name' | 'banned_words'

/**
 * Would Publish refuse this field's text, and with which code? publish-guard's own screens, then the visa screen. Any
 * code those screens throw comes back (never re-thrown: the form asks this while it renders), and the server attaches
 * the field to every one, as screenTeacherTexts always did.
 */
export function teacherTextRefusal(field: string, text: string | null | undefined): PublishBlockCode | null {
  if (!text) return null
  try {
    if (field === 'fullName') assertCleanContactName(text)
    else assertCleanTexts([text])
  } catch (e) {
    if (e instanceof PublishBlockedError) return e.code
    throw e
  }
  // ⛔ eno.vn carries no visa wording (licensing split) — on BOTH editions, since the row is shared.
  return teacherVisaMention(text) ? 'banned_words' : null
}

const TRIPS: Record<TeacherTextCode, (s: string) => boolean> = {
  contact_in_text: (s) => containsPhoneNumber(s) || containsContactInfo(s),
  contact_in_name: (s) => containsPhoneNumber(s) || containsContactInfo(s),
  banned_words: (s) => !!findBannedWord(s) || teacherVisaMention(s),
}

/**
 * The teacher's OWN words that make `code` refuse these texts (one field's — a job row passes its role, employer and
 * city), cut exactly as typed (tripping-words.ts) — at most three runs, or none when nothing can be pointed at (an older
 * tab, a code from elsewhere), and the form says what it said before. Never sent anywhere: the browser reads the text it
 * already holds. Asked while the form renders, so an unexpected error finds no words rather than taking the step down.
 */
export function teacherRefusedWords(code: string | undefined, texts: readonly (string | null | undefined)[]): string[] {
  const trips = code && code in TRIPS ? TRIPS[code as TeacherTextCode] : null
  if (!trips) return []
  const out: string[] = []
  try {
    for (const text of texts) {
      if (!text || !trips(text)) continue
      const words = trippingWords(text, trips)
      if (words && !out.includes(words)) out.push(words)
      if (out.length === 3) break
    }
  } catch {
    return out
  }
  return out
}
