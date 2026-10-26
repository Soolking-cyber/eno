import { containsContactInfo } from '@/lib/publish-guard'
import { containsPhoneNumber } from '@/lib/phone'

/**
 * ⛔ NO CONTACT DETAIL REACHES A LEARNER'S EARS — ACROSS SENTENCES TOO (2026-10-26 review, opus: "Call 0901. 234. 567."
 * passed the gate one sentence at a time, was spoken, then saved). A streamed reply is spoken sentence by sentence as it
 * is written (tutor-ai.ts tutorTurnStream), so each new sentence is checked TOGETHER WITH everything already said. And a
 * reply whose spoken words would carry more than MAX_SPOKEN_DIGITS digits in all stops there: a phone number is ten
 * digits, which a model can spread over sentences, words and punctuation that the pattern gates do not join — and a
 * tutor's reply almost never needs that many digits (a year is four).
 */
export const MAX_SPOKEN_DIGITS = 8

/** May `next` be spoken after `said`? Pure. */
export function mayBeSpoken(said: readonly string[], next: string): boolean {
  if (containsPhoneNumber(next) || containsContactInfo(next)) return false
  const all = [...said, next].join(' ')
  if (containsPhoneNumber(all) || containsContactInfo(all)) return false
  return (all.match(/\p{Nd}/gu) ?? []).length <= MAX_SPOKEN_DIGITS
}
