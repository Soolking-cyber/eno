/**
 * ENGLISH AND VIETNAMESE IN ONE LESSON (owner, 2026-11-10: "the avatar should recognize english and vietnamese and answer in
 * english and vietnamese when needed. if student is beginner they should get some support explanation in their language
 * which is vietnamese"). The tutor writes its Vietnamese help in its own field (tutor-ai.ts `support`), so the language of
 * each spoken line is KNOWN, never guessed — this test is only the defence in depth for a sentence the model wrote in
 * Vietnamese inside its English reply anyway, and for eno's own fixed lines.
 */

/** A letter only Vietnamese writes among the classroom's two languages: ă â đ ê ô ơ ư, and any tone mark on a vowel. */
const VIETNAMESE_LETTER = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/iu

/** Common English words that are never Vietnamese syllables (the ones that are — "do", "an", "to", "me", "no", "in", "can",
 *  and "my", a given name: "My ơi, con giỏi lắm!" — are left out). One in a sentence makes it English: "Bánh mì or phở?" (commit review round 2, opus) — but not inside
 *  quotes (the English word a Vietnamese sentence explains: 'Từ "good" nghĩa là tốt.'), and not a capitalised word inside
 *  the sentence, a name ("Chị My rất tốt.") — commit review round 3, codex + opus. */
const ENGLISH_WORD = /^(?:the|and|or|but|is|are|was|were|you|he|she|it|we|they|your|does|did|have|has|will|what|how|where|when|who|why|of|for|with|like|this|that|yes|not|please|i|i'm|it's|let's|would|could|should|some|any|very|good|great)$/i

/**
 * Is this sentence Vietnamese — at least 60% of its words carry a Vietnamese letter, and none is a common English word?
 * Written with its diacritics,
 * Vietnamese marks most syllables (language.test.ts has the lines checked); an English sentence naming a place ("I live in
 * Đà Nẵng.") stays under it. A short Vietnamese sentence of unmarked words ("Con mèo.") reads as English — the reason the
 * tutor's help has its own field and this is only the fallback. Pure.
 */
export function vietnameseSentence(text: string): boolean {
  // Quoted words are left out: they are what is being explained, in either language.
  const unquoted = text.normalize('NFC').replace(/"[^"]*"|“[^”]*”|‘[^’]*’|'[^']*'/g, ' ')
  const words = unquoted.split(/\s+/).filter((w) => /\p{L}/u.test(w))
  if (!words.length) return false
  const bare = (w: string) => w.replace(/^[^\p{L}']+|[^\p{L}']+$/gu, '')
  if (words.some((w, i) => ENGLISH_WORD.test(bare(w)) && (i === 0 || !/^\p{Lu}/u.test(bare(w))))) return false
  return words.filter((w) => VIETNAMESE_LETTER.test(w)).length / words.length >= 0.6
}
