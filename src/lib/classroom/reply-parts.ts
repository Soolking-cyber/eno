/**
 * A WHOLE REPLY CUT FOR ITS VOICE (owner 2026-10-26: "tts is slow"): a reply that already exists — a retried turn's, a
 * flagged turn's, eno's own lines — is voiced part by part (turn-stream.ts), so the avatar starts on the first part.
 * (A reply still being written is cut sentence by sentence as it arrives instead: tutor-ai.ts tutorTurnStream.)
 *
 *   replyParts()   the reply → its parts: cut at every sentence end, then a part shorter than MIN_PART_CHARS joins the
 *                  next one (a last short one joins the one before) — a few natural chunks, never "Nice!" made, and paused
 *                  after, on its own. Pure.
 *
 * "Mr." or "e.g." may end a "sentence" — harmless: a short piece joins the next, and a long one is only a pause in the
 * voice, never a lost word. Never an empty part, and the parts joined by single spaces are the reply itself with its runs
 * of spaces made one. ⛔ The words are never logged.
 * No 'server-only' here: the cut is pure, and nothing below needs the server's secrets.
 */
export const MIN_PART_CHARS = 40

/** A word that ends a sentence: its last character is . ! ? or … — so the mark itself is followed by a space, a line break
 *  or nothing (the turn route's contract, kept to the letter so a page cutting the same reply gets the same parts). A
 *  closing quote or bracket after the mark does not end one: `Say "I went." Then…` stays a single sentence. No lookbehind:
 *  older Safari cannot parse one, and this file may reach the page. */
const ENDS_SENTENCE = /[.!?…]$/

export function replyParts(reply: string): string[] {
  const sentences: string[] = []
  let words: string[] = []
  for (const word of reply.split(/\s+/)) {
    if (!word) continue
    words.push(word)
    if (ENDS_SENTENCE.test(word)) {
      sentences.push(words.join(' '))
      words = []
    }
  }
  if (words.length) sentences.push(words.join(' '))
  const parts: string[] = []
  let carry = ''
  for (const s of sentences) {
    carry = carry ? `${carry} ${s}` : s
    if (carry.length >= MIN_PART_CHARS) {
      parts.push(carry)
      carry = ''
    }
  }
  if (carry) {
    if (parts.length) parts[parts.length - 1] = `${parts[parts.length - 1]} ${carry}`
    else parts.push(carry)
  }
  return parts
}
