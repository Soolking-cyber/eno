import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MIN_PART_CHARS, replyParts } from './reply-parts'

/** The reply as the parts must give it back: trimmed, every run of spaces one space. */
const flat = (s: string) => s.trim().replace(/\s+/g, ' ')
/** A part may end only where a sentence does: on . ! ? or … itself. */
const ENDS_SENTENCE = /[.!?…]$/

/** What must hold for ANY reply. */
function holds(reply: string) {
  const parts = replyParts(reply)
  // never an empty part, never a stray space, and the parts joined by single spaces are the reply itself
  for (const p of parts) expect(p, reply).toMatch(/^\S(?:[\s\S]*\S)?$/)
  for (const p of parts) expect(p, reply).not.toMatch(/\s\s|[^\S ]/)
  expect(parts.join(' '), reply).toBe(flat(reply))
  expect(parts.join(' ').split(' ').filter(Boolean), reply).toEqual(reply.split(/\s+/).filter(Boolean))
  // a short part is only ever the reply's only part
  if (parts.length > 1) for (const p of parts) expect(p.length, p).toBeGreaterThanOrEqual(MIN_PART_CHARS)
  // every cut is at a sentence end
  for (const p of parts.slice(0, -1)) expect(p, reply).toMatch(ENDS_SENTENCE)
  return parts
}

describe('replyParts', () => {
  it('a short reply is one part', () => {
    expect(holds('Nice! Where did you go?')).toEqual(['Nice! Where did you go?'])
    expect(holds('Hello.')).toEqual(['Hello.'])
    expect(holds('ok')).toEqual(['ok'])
  })

  it('cuts at each sentence end; a sentence under 40 characters joins the NEXT one', () => {
    const reply = 'Great job! You went to the park with your family yesterday. That sounds like a really fun day out together. What animals did you see at the park? Tell me about the one you liked best.'
    expect(holds(reply)).toEqual([
      'Great job! You went to the park with your family yesterday.',
      'That sounds like a really fun day out together.',
      'What animals did you see at the park? Tell me about the one you liked best.',
    ])
    // short ones keep joining until the part is long enough
    expect(holds('Yes. Good. Well done. Now tell me what you ate for breakfast today, please.')).toEqual(['Yes. Good. Well done. Now tell me what you ate for breakfast today, please.'])
    expect(holds('Yes. Good. Well done. That is right. Now tell me about your breakfast today, please.')).toEqual([
      'Yes. Good. Well done. That is right. Now tell me about your breakfast today, please.',
    ])
  })

  it('a LAST short sentence joins the one before; a part of exactly 40 characters stands', () => {
    const forty = 'This sentence is exactly forty chars ok.'
    expect(forty).toHaveLength(MIN_PART_CHARS)
    expect(holds(`${forty} Say it with me.`)).toEqual([`${forty} Say it with me.`])
    expect(holds(`${forty} ${forty} Now you.`)).toEqual([forty, `${forty} Now you.`])
    // one character short of the floor: it joins the next
    const thirtyNine = forty.slice(1)
    expect(holds(`${thirtyNine} ${forty}`)).toEqual([`${thirtyNine} ${forty}`])
  })

  it('a sentence ends at . ! ? or … — one or several — followed by a space or a line break', () => {
    const a = 'You did really well with the past tense today!!'
    const b = 'Did you really go to the zoo with all your friends?'
    const c = 'I wonder what happened next at the old station…'
    const d = 'Really?! That is the most surprising news of the week.'
    const e = 'Wait... I think I know where you went last weekend.'
    expect(holds(`${a} ${b}\n${c}\n\n${d}\t${e}`)).toEqual([a, b, c, d, e])
  })

  it('a closing quote or bracket after the mark does NOT end a sentence (the contract’s rule, to the letter)', () => {
    const quoted = 'Can you say “I went to the zoo with my friends.” Then tell me which animal you liked the most.'
    expect(holds(quoted)).toEqual([quoted])
    const bracket = 'Try it once more, slowly (and loudly, if you can.) Then we can move on to the next sentence.'
    expect(holds(bracket)).toEqual([bracket])
    // …while a mark INSIDE the quotes, followed by a space, does
    expect(holds('He shouted “Wait for me at the gate, please! I am almost there.” And then he ran very fast to us.')).toEqual([
      'He shouted “Wait for me at the gate, please!',
      'I am almost there.” And then he ran very fast to us.',
    ])
  })

  it('NOT a sentence end: a decimal point, a dot inside a word or an address, punctuation with no space after it', () => {
    const one = 'It costs 3.5 dollars at eno.vn, and it is open at 8.30 every single morning!Really, every day.'
    expect(holds(one)).toEqual([one])
    const two = 'Hello!How are you today, and what did you have for lunch at school?'
    expect(holds(two)).toEqual([two])
  })

  it('"Mr." may cut — accepted: a short piece joins the next, so no part is a lone abbreviation; a long one is a part', () => {
    const parts = holds('Mr. Smith is your teacher, and Mrs. Lan teaches music at the school. Do you like them both?')
    expect(parts).toEqual(['Mr. Smith is your teacher, and Mrs. Lan teaches music at the school. Do you like them both?'])
    // both halves are long enough to stand: the voice pauses after "Mr." — the words are all still there
    expect(holds('I talked with my favourite English teacher Mr. Smith about the trip to Da Lat yesterday.')).toEqual([
      'I talked with my favourite English teacher Mr.',
      'Smith about the trip to Da Lat yesterday.',
    ])
  })

  it('never an empty part; nothing to say is no part at all', () => {
    expect(replyParts('')).toEqual([])
    expect(replyParts('   \n\t ')).toEqual([])
    expect(holds('  Spaces   everywhere.   And   more   spaces   after   the   first   sentence   here.  ')).toEqual(['Spaces everywhere. And more spaces after the first sentence here.'])
    expect(holds('.')).toEqual(['.'])
    expect(holds('! ? …')).toEqual(['! ? …'])
  })

  it('no lookbehind in the file: older Safari refuses to parse one, and the cut may run on the page', () => {
    expect(readFileSync(fileURLToPath(new URL('./reply-parts.ts', import.meta.url)), 'utf8')).not.toMatch(/\(\?<[=!]/)
  })

  it('never cuts inside an emoji or a word', () => {
    const reply = 'Wow, that is a great photo of your dog 🐶! Tell me his name and how old he is now 😀. Does he like to play?'
    const parts = holds(reply)
    for (const p of parts) {
      expect(p).not.toMatch(/^[\uDC00-\uDFFF]/)
      expect(p).not.toMatch(/[\uD800-\uDBFF]$/)
    }
  })

  it('eno’s own lines (the safety replies, the resume line) are cut like any reply', () => {
    const adult = 'Thank you for telling me. If you are in danger, please reach out to someone you trust or to local emergency services.'
    expect(holds(adult)).toEqual([adult])
    expect(holds('Thank you for telling me. That sounds important. Please talk to a grown-up you trust, like a parent or a teacher.')).toEqual([
      'Thank you for telling me. That sounds important.',
      'Please talk to a grown-up you trust, like a parent or a teacher.',
    ])
    const resume = "Let's keep practising. What would you like to talk about now?"
    expect(holds(resume)).toEqual([resume])
  })

  it('holds for every reply: hundreds of made-up ones, with odd spacing, quotes, numbers and abbreviations', () => {
    // A seeded generator: the same replies on every run.
    let seed = 20261026
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
    const WORDS = ['I', 'went', 'to', 'the', 'park', 'Mr.', 'e.g.', '3.5', 'eno.vn', 'yesterday', 'school', '"great', 'job"', '(really)', 'đi', 'học', '😀', 'Hello!How', 'U.S.', 'okay']
    const ENDS = ['.', '!', '?', '…', '...', '?!', '."', '!”', '.)', '.’', '']
    const GAPS = [' ', ' ', ' ', '  ', '\n', ' \n ', '\t']
    const counts = new Map<number, number>()
    for (let n = 0; n < 500; n++) {
      const sentences = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => {
        const words = Array.from({ length: 1 + Math.floor(rnd() * 14) }, () => pick(WORDS))
        return words.join(pick(GAPS)) + pick(ENDS)
      })
      const reply = pick(['', ' ', '\n']) + sentences.join(pick(GAPS)) + pick(['', ' ', '\n'])
      const n2 = holds(reply).length
      counts.set(n2, (counts.get(n2) ?? 0) + 1)
    }
    // not a vacuous run: plenty of single-part AND of several-part replies were checked
    expect(counts.get(1) ?? 0).toBeGreaterThan(50)
    expect([...counts].filter(([k]) => k >= 3).reduce((a, [, v]) => a + v, 0)).toBeGreaterThan(50)
  })
})
