import { checkFormula, constantArithmetic, constantsIn, namesIn, parseFormula, RESERVED_NAMES, type Kind } from './expr'
import { PRINTED_UNIT, runTool } from './run'

/**
 * A GENERATED TOOL IS A SPEC, NOT CODE (owner, 2026-11-23: eno Reach builds one useful tool for eno.vn a night). Reach's writer
 * answers with this JSON; ONE eno.vn page renders every spec (src/app/[lang]/tools/[slug]); nothing the model writes runs as
 * React or JS. Its words render as text, its arithmetic is formulas in expr.ts, and validateToolSpec below refuses anything else.
 * A person approves a spec in Reach (by its digest, canonical.ts), scripts/carry-tools.mjs carries it, and src/lib/tools/content.ts
 * refuses to build one whose text changed since.
 *
 * ⛔ ARITHMETIC ON WHAT THE READER TYPES, NOTHING ELSE: a real-world rate, price, fee or tax is an input the reader fills in, never
 * a number in a formula (ALLOWED_CONSTANTS: units and plain maths only). A tool never claims what is "usual" in Vietnam.
 * ⛔ No HTML, markdown, link or {placeholder} in any text (the page prints them through <Bilingual>, which reads {x} as a slot).
 *
 * ⚠️ PURE AND DEPENDENCY-FREE, COPIED VERBATIM into eno Reach (app/api/_tool-spec/) with expr.ts, run.ts and canonical.ts: the
 * check Reach runs before a person reads a draft is this one. What differs between the two apps comes in through `ctx`.
 */

/** Bump when a change alters what a spec means: every spec carries the version it was written for, and an old one is refused. */
export const TOOL_SPEC_VERSION = 1

export type Copy = { en: string; vi: string }
export type InputKind = 'money' | 'months' | 'number' | 'percent' | 'choice'
export type OutputFormat = 'money' | 'percent' | 'months' | 'number'
export type ToolInput = { id: string; kind: InputKind; label: Copy; help: Copy; default: number; min: number; max: number; choices?: { value: number; label: Copy }[] }
export type ToolOutput = { id: string; label: Copy; formula: string; format: OutputFormat }
export type ToolNote = { when: string; text: Copy }
export type ToolTest = { inputs: Record<string, number>; expect: Record<string, number> }
export type ToolSpec = {
  version: number
  slug: string
  title: Copy
  description: Copy
  intro: Copy
  /** Paragraphs, separated by a blank line. */
  howItWorks: Copy
  /** One limitation a line. */
  limitations: Copy
  inputs: ToolInput[]
  outputs: ToolOutput[]
  notes: ToolNote[]
  example: { inputs: Record<string, number> }
  tests: ToolTest[]
  faqs: { q: Copy; a: Copy }[]
  related: string[]
}

/** What the two apps supply: the eno.vn paths a tool may link, and the words it may not say (each app's edition rule + TOOL_INTERNALS_BANNED). */
export type ToolCtx = { relatedPaths: readonly string[]; banned: readonly RegExp[] }

/**
 * Words about how eno.vn judges people and listings: a tool that explains or simulates them teaches spammers what to dodge
 * (the reason the pre-publish checker and the trust-score simulator were skipped on 2026-11-23).
 */
export const TOOL_INTERNALS_BANNED = /trust\s*-?\s*scores?|điểm\s+(?:tin\s+cậy|uy\s+tín)|moderat(?:ion|ors?|ed|ing)|kiểm\s+duyệt|rank(?:ing)?\s*(?:scores?|signals?|algorithms?|factors?|formula)|thuật\s+toán\s+xếp\s+hạng|shadow\s*-?\s*bann?(?:ed|ing)?|spam\s+(?:filters?|scores?|rules?)|bộ\s+lọc\s+spam|fraud\s+(?:scores?|detection|signals?|rules?)|chống\s+gian\s+lận|listing\s+guard|price\s+floor/i

/**
 * The only numbers a formula may contain: units and plain maths (12 months, 100 for a percent, 365 days, 1,000 đồng in a "k").
 * A rate, price, fee or tax is the reader's to type. round's digits are not counted.
 */
export const ALLOWED_CONSTANTS: readonly number[] = [0, 1, 2, 3, 4, 7, 12, 24, 30, 52, 60, 100, 365, 1000]

/**
 * THE eno.vn PAGES A TOOL MAY LINK (`related`), each with the words its link prints. Marketplace pages that exist on eno.vn and
 * answer in both languages (src/lib/tools/tools.test.ts holds every path to a real route or live category).
 */
export const TOOL_LINKS: Readonly<Record<string, Copy>> = {
  '/tools': { en: 'All tools', vi: 'Tất cả công cụ' },
  '/rent-affordability-calculator': { en: 'Rent affordability calculator', vi: 'Tính tiền thuê nhà so với thu nhập' },
  '/move-in-cost-calculator': { en: 'Move-in cost calculator', vi: 'Tính tiền cần có khi ký hợp đồng thuê' },
  '/rental-cost-comparison': { en: 'Rental cost comparison', vi: 'So sánh chi phí thuê nhà' },
  '/vietnamese-price-converter': { en: 'Vietnamese price converter', vi: 'Đổi giá viết tắt ra số tiền' },
  '/hcmc-rent-index': { en: 'HCMC rent index: median asking rent by district', vi: 'Chỉ số giá thuê nhà TP.HCM: giá thuê trung vị theo quận' },
  '/c/rentals': { en: 'Homes for rent on eno.vn', vi: 'Nhà cho thuê trên eno.vn' },
  '/c/vehicles': { en: 'Motorbikes and cars on eno.vn', vi: 'Xe máy và ô tô trên eno.vn' },
  '/c/electronics': { en: 'Phones and electronics on eno.vn', vi: 'Điện thoại và đồ điện tử trên eno.vn' },
  '/c/furniture-appliances': { en: 'Furniture and appliances on eno.vn', vi: 'Nội thất và đồ gia dụng trên eno.vn' },
  '/c/jobs': { en: 'Jobs on eno.vn', vi: 'Việc làm trên eno.vn' },
  '/rental-deposit-vietnam': { en: 'Rental deposits in Vietnam', vi: 'Tiền cọc thuê nhà ở Việt Nam' },
  '/renting-an-apartment-vietnam-foreigner': { en: 'Renting an apartment in Vietnam', vi: 'Thuê căn hộ ở Việt Nam' },
  '/furnishing-a-home-in-vietnam': { en: 'Furnishing a home in Vietnam', vi: 'Sắm đồ cho nhà mới ở Việt Nam' },
  '/selling-up-before-you-leave-vietnam': { en: 'Selling up before you leave Vietnam', vi: 'Thanh lý đồ trước khi rời Việt Nam' },
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ID = /^[a-z][a-zA-Z0-9]{0,30}$/
const VI_MARK = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i
const MAX_BYTES = 20 * 1024
const MONEY_MAX = 100_000_000_000 // 100 tỷ đồng: above it, a typo
const KINDS: readonly InputKind[] = ['money', 'months', 'number', 'percent', 'choice']
const FORMATS: readonly OutputFormat[] = ['money', 'percent', 'months', 'number']

/** Field lengths, trimmed, in characters: [min, max]. `lines`: newlines allowed (paragraphs, or one limitation a line). */
const TEXT = {
  title: [10, 70], description: [60, 170], intro: [80, 600], howItWorks: [80, 1500], limitations: [30, 800],
  label: [2, 60], help: [5, 200], choice: [1, 40], note: [10, 300], q: [8, 160], a: [40, 700],
} as const

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** Written with at most n decimals: 7.5 yes, 1e-14 and 0.1 + 0.2 no (the field would start at a different figure). */
const decimals = (v: number, n: number) => Math.abs(v) < 1e21 && Number(v.toFixed(n)) === v
/** A value for a message, whatever it is: never String() of an object, which can throw. */
const shown = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || v === null ? String(v) : typeof v)

/** Why a text cannot be printed as plain text, or null. */
function plainProblem(s: string, lines: boolean): string | null {
  if (s !== s.trim()) return 'has spaces at its ends'
  if (s !== s.normalize('NFC')) return 'is not in composed Unicode (NFC)'
  // Control characters (C0 and C1), the Unicode line separators, and invisible format characters (bidi overrides and the like),
  // which change what a reader sees without showing themselves.
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]|\p{Cf}/u.test(s) || (!lines && s.includes('\n'))) return 'has a line break or an invisible character'
  if (/[<>]/.test(s)) return 'has < or >: plain text only, no HTML'
  if (/[{}]/.test(s)) return 'has { or }: the page would read them as a placeholder'
  if (/[*_`#]|\]\(|\[[^\]]*\]|^\s*[-+•]\s/m.test(s)) return 'has markdown (* _ ` # [ ] or a list mark): plain text only'
  const noSite = s.replace(/\beno\.vn\b/gi, '')
  if (/\b[a-z][a-z0-9+.-]*:\/\/|\b(?:mailto|tel|javascript|data):|www\.|\b[a-z0-9-]+\.(?:com|vn|net|org|io|co|info|biz|asia|app|dev|me|xyz|site|online|store|shop|link|top|club|ai|gg|tv|cc|ly|to|us|uk|edu|gov)\b|\S+@\S+\.\S+/i.test(noSite)) return 'has a web address or an email: links go in "related"'
  return null
}

/** Every string a reader could see in the spec (and the ids, read as words), with where it is. */
function stringsOf(v: unknown, at: string, out: [string, string][]) {
  if (typeof v === 'string') out.push([at, v])
  else if (Array.isArray(v)) v.forEach((x, i) => stringsOf(x, `${at}[${i}]`, out))
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) stringsOf(x, at ? `${at}.${k}` : k, out)
}

/** Whether a value typed into this input could be typed into the page: a number within its range, of the kind's precision. */
export function inputValueProblem(input: ToolInput, v: unknown): string | null {
  if (!isNum(v)) return 'is not a number'
  if (v < input.min || v > input.max) return `is outside ${input.min}..${input.max}`
  if (input.kind === 'money' && !Number.isInteger(v)) return 'must be whole đồng'
  if (input.kind === 'months' && !Number.isInteger(v * 2)) return 'must be whole or half months'
  if (input.kind === 'percent' && !decimals(v, 2)) return 'has more than 2 decimals'
  if (input.kind === 'number' && !decimals(v, 4)) return 'has more than 4 decimals'
  if (input.kind === 'choice' && !(input.choices ?? []).some((c) => c.value === v)) return 'is not one of its choices'
  return null
}

/**
 * Everything wrong with a spec, in words a writer (Claude, then a person) can act on. Empty means it may be shown on eno.vn.
 * Never throws, whatever it is given.
 */
export function validateToolSpec(spec: unknown, ctx: ToolCtx): string[] {
  const errs: string[] = []
  const out = () => errs.slice(0, 60)
  if (!isObj(spec)) return ['The spec is not a JSON object.']
  const keys = (o: Record<string, unknown>, at: string, allowed: readonly string[], required: readonly string[] = allowed) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) errs.push(`${at}: unknown field "${k}"`)
    for (const k of required) if (!(k in o)) errs.push(`${at}: missing field "${k}"`)
  }
  keys(spec, 'spec', ['version', 'slug', 'title', 'description', 'intro', 'howItWorks', 'limitations', 'inputs', 'outputs', 'notes', 'example', 'tests', 'faqs', 'related'])
  if (errs.length) return out()
  const s = spec as Record<string, unknown>

  if (s.version !== TOOL_SPEC_VERSION) errs.push(`version must be ${TOOL_SPEC_VERSION}`)
  if (typeof s.slug !== 'string' || !SLUG.test(s.slug) || s.slug.length < 3 || s.slug.length > 60) errs.push('slug must be 3-60 characters: lowercase words joined by single hyphens')

  const copy = (v: unknown, at: string, [min, max]: readonly [number, number], lines = false): v is Copy => {
    if (!isObj(v)) { errs.push(`${at} must be { "en", "vi" }`); return false }
    const before = errs.length
    keys(v, at, ['en', 'vi'])
    for (const l of ['en', 'vi'] as const) {
      const t = v[l]
      if (typeof t !== 'string') { if (l in v) errs.push(`${at}.${l} must be text`); continue }
      const n = t.trim().length
      if (n < min || n > max) errs.push(`${at}.${l} is ${n} characters, must be ${min}-${max}`)
      const bad = plainProblem(t, lines)
      if (bad) errs.push(`${at}.${l} ${bad}`)
    }
    return errs.length === before
  }
  const page = { title: s.title, description: s.description, intro: s.intro, howItWorks: s.howItWorks, limitations: s.limitations }
  for (const [k, v] of Object.entries(page)) copy(v, k, TEXT[k as keyof typeof page], k === 'howItWorks' || k === 'limitations')
  // The Vietnamese is written, not the English copied: the long fields need its marks.
  for (const k of ['title', 'description', 'intro', 'howItWorks'] as const) {
    const v = page[k]
    if (isObj(v) && typeof v.vi === 'string' && !VI_MARK.test(v.vi)) errs.push(`${k}.vi has no Vietnamese diacritics: write it in Vietnamese`)
  }
  // eno.vn's /llms.txt prints each tool's title and description, and must stop saying "free" the day posting stops being free.
  for (const k of ['title', 'description'] as const) {
    const v = page[k]
    if (isObj(v) && /free|miễn\s*phí|mien\s*phi/i.test([v.en, v.vi].filter((t) => typeof t === 'string').join(' '))) errs.push(`${k} says "free" (even inside a word): eno.vn's llms.txt prints it. Use other words`)
  }
  if (isObj(s.limitations)) {
    for (const l of ['en', 'vi'] as const) {
      const t = s.limitations[l]
      if (typeof t !== 'string') continue
      const items = t.split('\n')
      if (items.length > 6 || items.some((x) => x.trim().length < 10 || x.trim().length > 200)) errs.push(`limitations.${l}: 1-6 lines, each 10-200 characters`)
    }
  }

  // ── inputs ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const names = new Map<string, Kind>()
  const ids = new Set<string>()
  const idProblem = (id: unknown, at: string): id is string => {
    if (typeof id !== 'string' || !ID.test(id)) { errs.push(`${at}.id must be a letter then letters or digits (camelCase), at most 31 characters`); return false }
    if (RESERVED_NAMES.includes(id)) { errs.push(`${at}.id "${id}" is a word formulas reserve`); return false }
    if (ids.has(id)) { errs.push(`${at}.id "${id}" is used twice`); return false }
    ids.add(id)
    return true
  }
  const inputs: ToolInput[] = []
  if (!Array.isArray(s.inputs) || s.inputs.length < 1 || s.inputs.length > 8) errs.push('inputs must be a list of 1-8')
  else s.inputs.forEach((x, i) => {
    const at = `inputs[${i}]`
    if (!isObj(x)) { errs.push(`${at} must be an object`); return }
    const before = errs.length
    keys(x, at, ['id', 'kind', 'label', 'help', 'default', 'min', 'max', 'choices'], ['id', 'kind', 'label', 'help', 'default', 'min', 'max'])
    const okId = idProblem(x.id, at)
    copy(x.label, `${at}.label`, TEXT.label)
    copy(x.help, `${at}.help`, TEXT.help)
    if (!KINDS.includes(x.kind as InputKind)) { errs.push(`${at}.kind must be one of ${KINDS.join(', ')}`); return }
    const kind = x.kind as InputKind
    if (!isNum(x.min) || !isNum(x.max) || !isNum(x.default)) { errs.push(`${at}: default, min and max must be numbers`); return }
    if (x.min >= x.max) errs.push(`${at}: min must be below max`)
    if (Math.abs(x.min) > 1e12 || Math.abs(x.max) > 1e12) errs.push(`${at}: min and max must be within ±1e12`)
    if (kind === 'money' && (x.min < 0 || x.max > MONEY_MAX || !Number.isInteger(x.min) || !Number.isInteger(x.max))) errs.push(`${at}: a money input is whole đồng from 0 to ${MONEY_MAX}`)
    if (kind === 'months' && (x.min < 0 || x.max > 600)) errs.push(`${at}: a months input is 0-600`)
    if (kind === 'percent' && (x.min < -100 || x.max > 1000)) errs.push(`${at}: a percent input is -100 to 1000 (30 means 30%)`)
    if (kind === 'choice') {
      const cs = x.choices
      if (!Array.isArray(cs) || cs.length < 2 || cs.length > 6) errs.push(`${at}.choices must be a list of 2-6`)
      else {
        const values: number[] = []
        cs.forEach((c, j) => {
          if (!isObj(c)) { errs.push(`${at}.choices[${j}] must be an object`); return }
          keys(c, `${at}.choices[${j}]`, ['value', 'label'])
          if (!isNum(c.value) || Math.abs(c.value) > 1e12) errs.push(`${at}.choices[${j}].value must be a number`)
          else values.push(c.value)
          copy(c.label, `${at}.choices[${j}].label`, TEXT.choice)
        })
        if (new Set(values).size !== values.length) errs.push(`${at}.choices: two choices have one value`)
        if (values.length === cs.length && (x.min !== Math.min(...values) || x.max !== Math.max(...values))) errs.push(`${at}: a choice input's min and max are its smallest and largest choice values`)
      }
    } else if ('choices' in x) errs.push(`${at}: only a choice input has choices`)
    if (errs.length > before || !okId) return
    const input = x as unknown as ToolInput
    const bad = inputValueProblem(input, input.default)
    if (bad) errs.push(`${at}.default ${bad}`)
    inputs.push(input)
    names.set(input.id, 'number')
  })

  // ── outputs, in order: each reads the inputs and the outputs before it ───────────────────────────────────────────────────
  const outputs: ToolOutput[] = []
  const constants = (formula: string, node: Parameters<typeof constantsIn>[0], at: string) => {
    for (const c of constantsIn(node)) if (!ALLOWED_CONSTANTS.includes(c)) errs.push(`${at}: the number ${c} in "${formula}" is not a unit constant (${ALLOWED_CONSTANTS.join(', ')}). A rate, price, fee or tax must be an input the reader types`)
    const op = constantArithmetic(node)
    if (op) errs.push(`${at}: "${formula}" does arithmetic between numbers alone (${op}): every operation must read an input or an output. A rate, price, fee or tax must be an input the reader types`)
  }
  if (!Array.isArray(s.outputs) || s.outputs.length < 1 || s.outputs.length > 6) errs.push('outputs must be a list of 1-6')
  else s.outputs.forEach((x, i) => {
    const at = `outputs[${i}]`
    if (!isObj(x)) { errs.push(`${at} must be an object`); return }
    const before = errs.length
    keys(x, at, ['id', 'label', 'formula', 'format'])
    const okId = idProblem(x.id, at)
    copy(x.label, `${at}.label`, TEXT.label)
    if (!FORMATS.includes(x.format as OutputFormat)) errs.push(`${at}.format must be one of ${FORMATS.join(', ')}`)
    const p = parseFormula(x.formula)
    if (!p.ok) errs.push(`${at}.formula: ${p.error}`)
    else {
      const t = checkFormula(p.node, Object.fromEntries(names))
      if (!t.ok) errs.push(`${at}.formula: ${t.error} (an output reads inputs and earlier outputs only)`)
      else if (t.type !== 'number') errs.push(`${at}.formula must give a number, not a yes/no condition`)
      constants(x.formula as string, p.node, `${at}.formula`)
    }
    // Its name is in scope for the outputs after it even if it failed, so one mistake is reported once.
    if (okId) names.set(x.id as string, 'number')
    if (errs.length === before) outputs.push(x as unknown as ToolOutput)
  })

  // ── notes: a sentence shown when its condition holds ────────────────────────────────────────────────────────────────────
  if (!Array.isArray(s.notes) || s.notes.length > 6) errs.push('notes must be a list of at most 6')
  else s.notes.forEach((x, i) => {
    const at = `notes[${i}]`
    if (!isObj(x)) { errs.push(`${at} must be an object`); return }
    keys(x, at, ['when', 'text'])
    copy(x.text, `${at}.text`, TEXT.note)
    const p = parseFormula(x.when)
    if (!p.ok) { errs.push(`${at}.when: ${p.error}`); return }
    const t = checkFormula(p.node, Object.fromEntries(names))
    if (!t.ok) errs.push(`${at}.when: ${t.error}`)
    else if (t.type !== 'bool') errs.push(`${at}.when must be a yes/no condition, such as share > 30`)
    constants(x.when as string, p.node, `${at}.when`)
  })

  // Every input and output read: only then can anything be computed (a wrong title does not stop the tests being checked).
  const sound = Array.isArray(s.inputs) && inputs.length === s.inputs.length && Array.isArray(s.outputs) && outputs.length === s.outputs.length
  // An input nothing reads is a question the reader answers for nothing.
  if (sound) {
    const read = new Set<string>()
    for (const o of outputs) { const p = parseFormula(o.formula); if (p.ok) namesIn(p.node).forEach((n) => read.add(n)) }
    for (const n of Array.isArray(s.notes) ? s.notes : []) { const p = isObj(n) ? parseFormula(n.when) : null; if (p?.ok) namesIn(p.node).forEach((x) => read.add(x)) }
    for (const inp of inputs) if (!read.has(inp.id)) errs.push(`input "${inp.id}" is not used by any formula`)
  }

  // ── the example and the worked tests: values the page could take, answers worked out independently ──────────────────────
  const complete = (v: unknown, at: string): v is Record<string, number> => {
    if (!isObj(v)) { errs.push(`${at} must be { inputId: value }`); return false }
    const before = errs.length
    for (const k of Object.keys(v)) if (!inputs.some((inp) => inp.id === k)) errs.push(`${at}: "${k}" is not an input`)
    for (const inp of inputs) {
      if (!(inp.id in v)) { errs.push(`${at}: no value for "${inp.id}"`); continue }
      const bad = inputValueProblem(inp, v[inp.id])
      if (bad) errs.push(`${at}.${inp.id} ${bad}`)
    }
    return errs.length === before
  }
  if (!isObj(s.example)) errs.push('example must be { "inputs": { … } }')
  else {
    keys(s.example, 'example', ['inputs'])
    if (complete(s.example.inputs, 'example.inputs') && sound) {
      const run = runTool({ outputs, notes: [] }, s.example.inputs)
      for (const o of outputs) if (run.outputs[o.id] === null) errs.push(`example: "${o.id}" cannot be computed from the example's figures, and the page prints the example`)
    }
  }
  if (!Array.isArray(s.tests) || s.tests.length < 3 || s.tests.length > 8) errs.push('tests must be a list of 3-8 worked cases')
  else {
    const seen = new Set<string>()
    s.tests.forEach((x, i) => {
      const at = `tests[${i}]`
      if (!isObj(x)) { errs.push(`${at} must be an object`); return }
      keys(x, at, ['inputs', 'expect'])
      const okInputs = complete(x.inputs, `${at}.inputs`)
      if (okInputs) {
        const key = JSON.stringify(inputs.map((inp) => (x.inputs as Record<string, number>)[inp.id]))
        if (seen.has(key)) errs.push(`${at}: the same figures as an earlier test`)
        seen.add(key)
      }
      const e = x.expect
      if (!isObj(e) || !Object.keys(e).length || Object.keys(e).length > 6) { errs.push(`${at}.expect must name 1-6 outputs and what each should be`); return }
      for (const [k, v] of Object.entries(e)) {
        if (!outputs.some((o) => o.id === k) && !(Array.isArray(s.outputs) && s.outputs.some((o) => isObj(o) && o.id === k))) errs.push(`${at}.expect: "${k}" is not an output`)
        if (!isNum(v)) errs.push(`${at}.expect.${k} must be a number`)
      }
      if (!okInputs || !sound) return
      const run = runTool({ outputs, notes: [] }, x.inputs as Record<string, number>)
      for (const [k, want] of Object.entries(e)) {
        const o = outputs.find((y) => y.id === k)
        if (!o || !isNum(want)) continue
        const got = run.outputs[k]
        // Within half a percent, or within what the page prints of it (1 đồng, 0.1 percentage point or month, 0.01).
        if (got === null) errs.push(`${at}: "${k}" should be ${want} by your own working, but the formulas cannot compute it`)
        else if (Math.abs(got - want) > Math.max(PRINTED_UNIT[o.format], Math.abs(want) * 0.005) + 1e-9) errs.push(`${at}: "${k}" should be ${want} by your own working, the formulas give ${Number(got.toPrecision(12))}`)
      }
    })
  }

  // Every output is worked out by hand in at least one test: one left out is arithmetic nobody checked (codex review, 2026-11-23).
  if (sound && Array.isArray(s.tests)) {
    const checked = new Set(s.tests.flatMap((x) => (isObj(x) && isObj(x.expect) ? Object.keys(x.expect) : [])))
    for (const o of outputs) if (!checked.has(o.id)) errs.push(`output "${o.id}" is not in any test's "expect": work it out by hand in at least one`)
  }

  // ── FAQ, links, size, words ─────────────────────────────────────────────────────────────────────────────────────────────
  if (!Array.isArray(s.faqs) || s.faqs.length < 3 || s.faqs.length > 5) errs.push('faqs must be a list of 3-5')
  else s.faqs.forEach((x, i) => {
    if (!isObj(x)) { errs.push(`faqs[${i}] must be an object`); return }
    keys(x, `faqs[${i}]`, ['q', 'a'])
    copy(x.q, `faqs[${i}].q`, TEXT.q)
    copy(x.a, `faqs[${i}].a`, TEXT.a)
  })
  if (!Array.isArray(s.related) || s.related.length > 4) errs.push('related must be a list of at most 4 eno.vn paths')
  else {
    s.related.forEach((r, i) => { if (typeof r !== 'string' || !ctx.relatedPaths.includes(r)) errs.push(`related[${i}] "${shown(r)}" is not a path a tool may link: ${ctx.relatedPaths.join(' ')}`) })
    if (new Set(s.related).size !== s.related.length) errs.push('related names one path twice')
  }
  let bytes = Infinity
  try { bytes = new TextEncoder().encode(JSON.stringify(spec)).length } catch { /* below */ }
  if (bytes > MAX_BYTES) errs.push(`the spec is ${bytes} bytes, at most ${MAX_BYTES}`)

  const strings: [string, string][] = []
  stringsOf(spec, '', strings)
  for (const [at, raw] of strings) {
    // As read, with hyphens and underscores as the spaces they stand for, and an id's camelCase as words.
    const t = raw.normalize('NFC')
    const forms = [t, t.replace(/[-_]+/g, ' '), t.replace(/([a-z])([A-Z])/g, '$1 $2')]
    for (const re of ctx.banned) {
      const hit = forms.map((f) => f.match(re)).find(Boolean)
      if (hit) { errs.push(`${at || 'spec'} says "${hit[0]}", which may not appear on eno.vn`); break }
    }
  }
  return out()
}
