/**
 * ENGLISH AND VIETNAMESE IN ONE LESSON (owner, 2026-11-10: "the avatar should recognize english and vietnamese and answer in
 * english and vietnamese when needed. if student is beginner they should get some support explanation in their language
 * which is vietnamese"). The tutor writes its Vietnamese help in its own field (tutor-ai.ts `support`), so the language of
 * each spoken line is KNOWN, never guessed — this test is only the defence in depth for a sentence the model wrote in
 * Vietnamese inside its English reply anyway, and for eno's own fixed lines.
 */

/** A letter only Vietnamese writes among the classroom's two languages: ă â đ ê ô ơ ư, and any tone mark on a vowel. */
const VIETNAMESE_LETTER = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/iu

/**
 * Is this sentence Vietnamese — at least 60% of its words carry a Vietnamese letter? Written with its diacritics,
 * Vietnamese marks most syllables (language.test.ts has the lines checked); an English sentence naming a place ("I live in
 * Đà Nẵng.") stays under it. A short Vietnamese sentence of unmarked words ("Con mèo.") reads as English — the reason the
 * tutor's help has its own field and this is only the fallback. Pure.
 */
export function vietnameseSentence(text: string): boolean {
  const words = text.normalize('NFC').split(/\s+/).filter((w) => /\p{L}/u.test(w))
  if (!words.length) return false
  return words.filter((w) => VIETNAMESE_LETTER.test(w)).length / words.length >= 0.6
}
