/**
 * ⛔ THE EDITION RULE, AT BUILD TIME. eno.vn is a licensed marketplace and may not mention entry or stay documents. For the Teach library a test enforces it; these guides are written by a
 * machine and carried over in bulk, so a broken one must not reach a build at all: content.ts refuses it. This is src/test/edition-words.ts EDITION_BANNED (which pulls in TypeScript and cannot be
 * imported at run time); guides.test.ts fails if the two differ.
 *
 * Exactly that rule, and no wider: one hit fails every deploy, so a word list that can catch "hành vi sa thải" does not belong here. The wider, fuzzier list is where a false match only costs a
 * rewrite: the writer's own check in eno Reach (app/api/_content.ts checkGuide). After that a person reads every guide before it is approved.
 */
export const GUIDE_BANNED = /\bvisas?\b|\be-?visas?\b|evisa|thị\s+thực|itinerar|paypal|temporary\s+residence|residence\s+card|residence\s+permit|\bTRCs?\b|immigration|nhập\s+cảnh|tạm\s+trú|overstay|border\s+run|entry\s+permit|exit\s+permit|extend\s+your\s+stay|sponsorship\s+letter/i

/** What a reader sees: bold markers and a link's address vanish on the page, so **vi**sa and Pay[Pal](/x) both print the word. So do characters nobody sees. */
const visible = (s: string) => s.replace(/\p{Cf}/gu, '').replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

/** The first banned word anywhere in this value, one string at a time (serialised JSON turns a newline into "\\n", which hides the word after it): as printed and as written, which holds the addresses, each with its hyphens read as the spaces they stand for. */
export function bannedWordIn(value: unknown): string | null {
  if (typeof value === 'string') {
    const raw = value.normalize('NFC')
    for (const text of [visible(raw), raw]) {
      const hit = text.match(GUIDE_BANNED) ?? text.replace(/[-_]+/g, ' ').match(GUIDE_BANNED)
      if (hit) return hit[0]
    }
    return null
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const word = bannedWordIn(v)
      if (word) return word
    }
    return null
  }
  return value && typeof value === 'object' ? bannedWordIn(Object.values(value)) : null
}
