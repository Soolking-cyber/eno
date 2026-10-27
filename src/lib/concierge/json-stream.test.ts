import { describe, expect, it } from 'vitest'
import { partialText, topLevelMembers, type Member } from './json-stream'

/**
 * READING THE CONCIERGE'S ANSWER WHILE IT IS WRITTEN (PLAN §3: "`action` the moment its JSON closes"; §7: "parser (chunk
 * sizes 1–7, braces in strings, say-before-action)"). topLevelMembers is pure over the text read so far, so checking EVERY
 * prefix of an answer checks every place a chunk can end — against a reference built from where each value really starts
 * and ends.
 */

const ACTION = { kind: 'browse', mode: 'refine', category: 'teachers', subcategory: '', filters: [{ key: 'workIn', value: 'd1' }], search: '', target: '' }
const SAY = 'Showing teachers who can teach in District 1. Native speaker, or is fluent English fine?'
const CHIPS = ['Native', 'Fluent is fine']
/** The owner's example, as the brain writes it (PLAN §1, §10). */
const SAMPLE = '{"action":{"kind":"browse","mode":"refine","category":"teachers","subcategory":"","filters":[{"key":"workIn","value":"d1"}],"search":"","target":""},"say":"Showing teachers who can teach in District 1. Native speaker, or is fluent English fine?","chips":["Native","Fluent is fine"]}'
/** Where the action's object closes (exclusive end of its raw text). */
const ACTION_END = SAMPLE.indexOf(',"say":')

type Span = { key: string; raw: string; start: number; end: number }
type Layout = { lead: string; colon: string; sep: string; trail: string }
const COMPACT: Layout = { lead: '', colon: ':', sep: ',', trail: '' }
/**
 * An object written member by member from raw JSON (keys as literals, so a key can carry an escape), recording where each
 * value's raw text starts and ends. Values here are strings, objects or arrays: complete the moment they close.
 */
function assemble(parts: [keyRaw: string, raw: string][], f: Layout = COMPACT): { json: string; spans: Span[] } {
  let json = `{${f.lead}`
  const spans: Span[] = []
  parts.forEach(([keyRaw, raw], n) => {
    if (n) json += f.sep
    json += `${keyRaw}${f.colon}`
    spans.push({ key: JSON.parse(keyRaw) as string, raw, start: json.length, end: json.length + raw.length })
    json += raw
  })
  return { json: `${json}${f.trail}}`, spans }
}
/** What the reader must report for the first `n` characters: each value that has begun, as far as it is written. */
const expected = (spans: Span[], n: number): Member[] =>
  spans.filter((s) => s.start < n).map((s) => ({ key: s.key, raw: s.raw.slice(0, n - s.start), complete: n >= s.end }))
/** Every prefix of `json`, read and compared with the reference. */
function everyPrefix(json: string, spans: Span[]) {
  for (let n = 0; n <= json.length; n++) expect(topLevelMembers(json.slice(0, n)), JSON.stringify(json.slice(0, n))).toEqual(expected(spans, n))
}
const members = (o: Record<string, unknown>, f?: Layout, pretty = false) =>
  assemble(Object.entries(o).map(([k, v]) => [JSON.stringify(k), pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v)]), f)

describe('topLevelMembers — the sample answer at every chunk boundary', () => {
  it('the fixture is the answer the schema asks for, in its order', () => {
    expect(SAMPLE).toBe(JSON.stringify({ action: ACTION, say: SAY, chips: CHIPS }))
    expect(members({ action: ACTION, say: SAY, chips: CHIPS }).json).toBe(SAMPLE)
  })

  it('the whole answer: three complete members whose raw text is exactly their JSON', () => {
    const m = topLevelMembers(SAMPLE)
    expect(m.map((x) => [x.key, x.complete])).toEqual([['action', true], ['say', true], ['chips', true]])
    expect(m.map((x) => JSON.parse(x.raw))).toEqual([ACTION, SAY, CHIPS])
  })

  it('every prefix: each value is reported from its first character, as far as it is written, complete only once it closes', () => {
    const { json, spans } = members({ action: ACTION, say: SAY, chips: CHIPS })
    everyPrefix(json, spans)
  })

  for (const size of [1, 2, 3, 4, 5, 6, 7]) {
    it(`fed in ${size}-character chunks: the action is complete at the chunk that closes its object — never before`, () => {
      let text = ''
      let completeAt = -1
      for (let i = 0; i < SAMPLE.length; i += size) {
        text += SAMPLE.slice(i, i + size)
        const a = topLevelMembers(text).find((m) => m.key === 'action')
        if (!a?.complete) {
          expect(text.length).toBeLessThan(ACTION_END)
          continue
        }
        if (completeAt < 0) completeAt = text.length
        expect(JSON.parse(a.raw)).toEqual(ACTION)
      }
      expect(completeAt).toBe(Math.min(SAMPLE.length, Math.ceil(ACTION_END / size) * size))
    })
  }

  it('Gemini order (say before action, chips between): the same, member by member', () => {
    const { json, spans } = members({ say: SAY, chips: CHIPS, action: ACTION })
    everyPrefix(json, spans)
  })

  it('pretty-printed and CRLF/tab layouts: whitespace around keys, colons and commas is skipped', () => {
    const answer = { action: ACTION, say: SAY, chips: CHIPS }
    const pretty = members(answer, { lead: '\n  ', colon: ': ', sep: ',\n  ', trail: '\n' }, true)
    expect(JSON.parse(pretty.json)).toEqual(answer)
    everyPrefix(pretty.json, pretty.spans)
    const loose = members(answer, { lead: '\r\n\t', colon: ' :\t', sep: ' ,\r\n\t', trail: '\r\n' })
    expect(JSON.parse(loose.json)).toEqual(answer)
    everyPrefix(loose.json, loose.spans)
  })
})

describe('topLevelMembers — braces, brackets and quotes inside strings', () => {
  const action = { ...ACTION, filters: [{ key: 'brand', value: 'a}b]c{d[e' }], search: 'say "}" {x} [y] \\ done' }
  const say = 'He wrote "}" and "]" then {[ — fine. A back\\slash "\\" too.'
  const chips = ['"}"', '[', '\\', '{"say":"x"}']

  it('every prefix of an answer full of them: nothing closes early, and every raw text parses to its value', () => {
    const { json, spans } = members({ action, say, chips })
    everyPrefix(json, spans)
    expect(topLevelMembers(json).map((m) => JSON.parse(m.raw))).toEqual([action, say, chips])
  })

  it('escapes, \\u ones included, in keys and values', () => {
    // Hand-written: JSON.stringify writes no \u escape for these characters.
    const raw = '"caf\\u00e9 \\ud83d\\ude00 \\"q\\" \\\\ \\/ \\b\\f\\n\\r\\t }]{[ end."'
    const { json, spans } = assemble([['"say"', raw], ['"caf\\u00e9"', '"x"'], ['"a\\"b"', '"y"'], ['"chips"', '["\\u005d","\\"]"]']])
    everyPrefix(json, spans)
    const whole = topLevelMembers(json)
    expect(whole.map((m) => m.key)).toEqual(['say', 'café', 'a"b', 'chips'])
    expect(JSON.parse(whole[0].raw)).toBe('café 😀 "q" \\ / \b\f\n\r\t }]{[ end.')
    expect(JSON.parse(whole[3].raw)).toEqual([']', '"]'])
  })

  it('⛔ a nested key named "say" is never a top-level member (the schema has none, and the reader could not be fooled)', () => {
    expect(topLevelMembers('{"action":{"say":"no","kind":"none"')).toEqual([{ key: 'action', raw: '{"say":"no","kind":"none"', complete: false }])
    expect(topLevelMembers('{"action":{"say":"no"},"say":"yes"}').map((m) => [m.key, m.raw])).toEqual([['action', '{"say":"no"}'], ['say', '"yes"']])
    expect(topLevelMembers('{"chips":[{"say":"no"}],"say":"ye').map((m) => [m.key, m.raw, m.complete])).toEqual([['chips', '[{"say":"no"}]', true], ['say', '"ye', false]])
  })
})

describe('topLevelMembers — the edges', () => {
  it('nothing yet: no object, no key, no colon or no value', () => {
    for (const t of ['', 'Sure, here', '{', '{ ', '{"act', '{"action"', '{"action" ', '{"action":', '{"action": \n']) expect(topLevelMembers(t), t).toEqual([])
  })

  it('text before the object (a code fence) is skipped', () => {
    expect(topLevelMembers('```json\n{"say":"Hi."}\n```')).toEqual([{ key: 'say', raw: '"Hi."', complete: true }])
  })

  it('a number, true, false or null is complete once a delimiter follows it', () => {
    expect(topLevelMembers('{"n":12')).toEqual([{ key: 'n', raw: '12', complete: false }])
    expect(topLevelMembers('{"n":12 ')).toEqual([{ key: 'n', raw: '12', complete: true }])
    expect(topLevelMembers('{"n":-1.5e3,"t":true,"f":false,"z":null}')).toEqual([
      { key: 'n', raw: '-1.5e3', complete: true },
      { key: 't', raw: 'true', complete: true },
      { key: 'f', raw: 'false', complete: true },
      { key: 'z', raw: 'null', complete: true },
    ])
  })

  it('a member cut inside a string ending in a backslash is still being written', () => {
    expect(topLevelMembers('{"say":"cut \\')).toEqual([{ key: 'say', raw: '"cut \\', complete: false }])
    expect(topLevelMembers('{"action":{"search":"a\\"}')).toEqual([{ key: 'action', raw: '{"search":"a\\"}', complete: false }])
  })
})

describe('partialText', () => {
  const RAW = '"caf\\u00e9 \\ud83d\\ude00 \\"q\\" \\\\ \\/ \\b\\f\\n\\r\\t }]{[ end."'
  const TEXT = 'café 😀 "q" \\ / \b\f\n\r\t }]{[ end.'

  it('decodes every escape JSON has — \\u and a surrogate pair included — exactly as JSON.parse', () => {
    expect(JSON.parse(RAW)).toBe(TEXT)
    expect(partialText(RAW)).toBe(TEXT)
  })

  it('every cut of the literal reads as a prefix of the whole text, never shorter than the cut before', () => {
    let last = ''
    for (let n = 1; n <= RAW.length; n++) {
      const t = partialText(RAW.slice(0, n))
      expect(TEXT.startsWith(t), RAW.slice(0, n)).toBe(true)
      expect(t.length).toBeGreaterThanOrEqual(last.length)
      last = t
    }
  })

  it('an escape cut in half waits for the rest', () => {
    expect(partialText('"cut \\')).toBe('cut ')
    expect(partialText('"caf\\u')).toBe('caf')
    expect(partialText('"caf\\u00e')).toBe('caf')
    expect(partialText('"caf\\u00e9')).toBe('café')
    expect(partialText('"say \\"')).toBe('say "')
    expect(partialText('"a\\nb')).toBe('a\nb')
  })

  it('ends at the closing quote; an empty literal is empty', () => {
    expect(partialText('"Done.","chips":[]')).toBe('Done.')
    expect(partialText('"')).toBe('')
    expect(partialText('""')).toBe('')
  })

  it('the sample answer\'s say, streamed: the text grows to the whole sentence pair and no further', () => {
    let text = ''
    let last = ''
    for (let i = 0; i < SAMPLE.length; i += 3) {
      text += SAMPLE.slice(i, i + 3)
      const s = topLevelMembers(text).find((m) => m.key === 'say')
      if (!s) continue
      const t = partialText(s.raw)
      expect(SAY.startsWith(t)).toBe(true)
      expect(t.length).toBeGreaterThanOrEqual(last.length)
      last = t
    }
    expect(last).toBe(SAY)
  })
})
