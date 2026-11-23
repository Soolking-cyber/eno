/**
 * THE FORMULA LANGUAGE OF A GENERATED TOOL (owner, 2026-11-23: eno Reach "builds 1 useful tool related to our website" a night).
 * A tool Reach writes is DATA, never code: its outputs are formulas in this tiny language, read here by a hand-written tokenizer,
 * parser, type checker and evaluator. ⛔ NO eval, NO Function, NO regex lookbehind (Safari 16.0–16.3: chunk-lookbehind-guard) —
 * it runs in the reader's browser.
 *
 * What a formula may say: numbers; names (the tool's input ids and its EARLIER output ids); + - * / (and − for minus); unary
 * minus; parentheses; < <= > >= == != (numbers only); and, or, not; if(c, a, b); min, max (2–8 arguments); round(x[, digits]);
 * floor, ceil, abs. Arithmetic and the functions give numbers, comparisons and logic give booleans, and mixing them is an error
 * found when the tool is validated, never on the page.
 * Caps: 300 characters, depth 20, 200 nodes. Division by zero, NaN, ±Infinity or a magnitude past 1e15 is "cannot compute"
 * for that output — never a number on screen.
 *
 * ⚠️ PURE AND DEPENDENCY-FREE (no React, Next or app imports): this file, run.ts, spec.ts and canonical.ts are COPIED VERBATIM
 * into eno Reach (app/api/_tool-spec/), which validates and previews what it writes with the same code eno.vn renders it with.
 * Both run test-vectors.json. Change them together, and bump TOOL_SPEC_VERSION (spec.ts) when a change alters what a spec means.
 */

export const FORMULA_LIMITS = { chars: 300, depth: 20, nodes: 200 } as const
/** Past this, a figure is a typo or an overflow, not an answer (and past 2^53 it would print digits that are not there). */
export const MAX_MAGNITUDE = 1e15

export const FUNCTIONS = ['if', 'min', 'max', 'round', 'floor', 'ceil', 'abs'] as const
type Fn = (typeof FUNCTIONS)[number]
/** Words a formula reserves: no input or output may be named one of them. */
export const RESERVED_NAMES: readonly string[] = [...FUNCTIONS, 'and', 'or', 'not', 'true', 'false']

export type ArithOp = '+' | '-' | '*' | '/'
export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!='
export type Node =
  | { k: 'num'; v: number }
  | { k: 'ref'; name: string }
  | { k: 'neg'; a: Node }
  | { k: 'not'; a: Node }
  | { k: 'arith'; op: ArithOp; a: Node; b: Node }
  | { k: 'cmp'; op: CmpOp; a: Node; b: Node }
  | { k: 'logic'; op: 'and' | 'or'; a: Node; b: Node }
  | { k: 'call'; fn: Fn; args: Node[] }

export type Kind = 'number' | 'bool'
export type Value = number | boolean

type Tok = { t: 'num'; v: number; at: number } | { t: 'name'; v: string; at: number } | { t: 'op'; v: string; at: number } | { t: 'end'; at: number }

const isDigit = (c: string) => c >= '0' && c <= '9'
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
const TWO = ['<=', '>=', '==', '!=']
const ONE = ['+', '-', '*', '/', '(', ')', ',', '<', '>']

class FormulaError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if (isDigit(c)) {
      let j = i
      while (j < src.length && isDigit(src[j])) j++
      if (src[j] === '.') {
        j++
        if (!isDigit(src[j] ?? '')) throw new FormulaError(`a number at position ${i + 1} ends in a point`)
        while (j < src.length && isDigit(src[j])) j++
      }
      if (j - i > 16) throw new FormulaError(`the number at position ${i + 1} is too long`)
      out.push({ t: 'num', v: Number(src.slice(i, j)), at: i })
      i = j
      continue
    }
    if (isLetter(c)) {
      let j = i
      while (j < src.length && (isLetter(src[j]) || isDigit(src[j]))) j++
      out.push({ t: 'name', v: src.slice(i, j), at: i })
      i = j
      continue
    }
    const two = src.slice(i, i + 2)
    if (TWO.includes(two)) { out.push({ t: 'op', v: two, at: i }); i += 2; continue }
    // The minus sign people type from a phone or copy from a page reads as a minus.
    if (c === '−') { out.push({ t: 'op', v: '-', at: i }); i++; continue }
    if (ONE.includes(c)) { out.push({ t: 'op', v: c, at: i }); i++; continue }
    throw new FormulaError(`"${c}" at position ${i + 1} is not part of the formula language`)
  }
  out.push({ t: 'end', at: src.length })
  return out
}

/** A formula read into its tree, or why it cannot be. Checks the caps; types are checkFormula's job. */
export function parseFormula(src: unknown): { ok: true; node: Node } | { ok: false; error: string } {
  if (typeof src !== 'string' || !src.trim()) return { ok: false, error: 'the formula is empty' }
  if (src.length > FORMULA_LIMITS.chars) return { ok: false, error: `the formula is ${src.length} characters, at most ${FORMULA_LIMITS.chars}` }
  try {
    const toks = tokenize(src)
    let p = 0
    let nodes = 0
    // Brackets, minus signs, "not" and arguments open a level each: past the cap the parse stops here, never deep in the call stack.
    let open = 0
    const enter = () => { if (++open > FORMULA_LIMITS.depth) throw new FormulaError(`the formula nests deeper than ${FORMULA_LIMITS.depth}`) }
    const peek = () => toks[p]
    const isOp = (v: string) => { const t = toks[p]; return t.t === 'op' && t.v === v }
    const isWord = (v: string) => { const t = toks[p]; return t.t === 'name' && t.v === v }
    const expect = (v: string) => {
      if (!isOp(v)) throw new FormulaError(`expected "${v}" at position ${peek().at + 1}`)
      p++
    }
    const make = (n: Node): Node => {
      if (++nodes > FORMULA_LIMITS.nodes) throw new FormulaError(`the formula has more than ${FORMULA_LIMITS.nodes} parts`)
      return n
    }
    const nested = (read: () => Node): Node => { enter(); const n = read(); open--; return n }
    const orExpr = (): Node => {
      let a = andExpr()
      while (isWord('or')) { p++; a = make({ k: 'logic', op: 'or', a, b: andExpr() }) }
      return a
    }
    const andExpr = (): Node => {
      let a = notExpr()
      while (isWord('and')) { p++; a = make({ k: 'logic', op: 'and', a, b: notExpr() }) }
      return a
    }
    const notExpr = (): Node => {
      if (isWord('not')) { p++; return make({ k: 'not', a: nested(notExpr) }) }
      return cmpExpr()
    }
    const CMP = ['<', '<=', '>', '>=', '==', '!=']
    const cmpExpr = (): Node => {
      const a = addExpr()
      const t = peek()
      if (t.t === 'op' && CMP.includes(t.v)) {
        p++
        const node = make({ k: 'cmp', op: t.v as CmpOp, a, b: addExpr() })
        const after = peek()
        // a < b < c reads as a chain in maths and as (a < b) < c in most languages: neither is allowed.
        if (after.t === 'op' && CMP.includes(after.v)) throw new FormulaError(`two comparisons in a row at position ${after.at + 1}: join them with "and"`)
        return node
      }
      return a
    }
    const addExpr = (): Node => {
      let a = mulExpr()
      for (let t = peek(); t.t === 'op' && (t.v === '+' || t.v === '-'); t = peek()) { p++; a = make({ k: 'arith', op: t.v, a, b: mulExpr() }) }
      return a
    }
    const mulExpr = (): Node => {
      let a = unary()
      for (let t = peek(); t.t === 'op' && (t.v === '*' || t.v === '/'); t = peek()) { p++; a = make({ k: 'arith', op: t.v, a, b: unary() }) }
      return a
    }
    const unary = (): Node => {
      if (isOp('-')) { p++; return make({ k: 'neg', a: nested(unary) }) }
      return primary()
    }
    const primary = (): Node => {
      const t = peek()
      if (t.t === 'num') { p++; return make({ k: 'num', v: t.v }) }
      if (isOp('(')) {
        p++
        const inner = nested(orExpr)
        expect(')')
        return inner
      }
      if (t.t === 'name') {
        p++
        if ((FUNCTIONS as readonly string[]).includes(t.v)) {
          if (!isOp('(')) throw new FormulaError(`${t.v} needs its arguments in brackets, at position ${t.at + 1}`)
          p++
          const args: Node[] = []
          if (!isOp(')')) {
            args.push(nested(orExpr))
            while (isOp(',')) { p++; args.push(nested(orExpr)) }
          }
          expect(')')
          return make({ k: 'call', fn: t.v as Fn, args })
        }
        if (RESERVED_NAMES.includes(t.v)) throw new FormulaError(`"${t.v}" cannot stand here (position ${t.at + 1})`)
        return make({ k: 'ref', name: t.v })
      }
      if (t.t === 'end') throw new FormulaError('the formula ends too early')
      throw new FormulaError(`unexpected "${t.v}" at position ${t.at + 1}`)
    }
    const node = orExpr()
    const rest = peek()
    if (rest.t !== 'end') throw new FormulaError(`unexpected "${rest.v}" at position ${rest.at + 1}`)
    if (depthOf(node) > FORMULA_LIMITS.depth) throw new FormulaError(`the formula nests deeper than ${FORMULA_LIMITS.depth}`)
    return { ok: true, node }
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message }
    // A stack overflow or anything else unforeseen is a refusal too, never a crash of the page or the validator.
    return { ok: false, error: 'the formula cannot be read' }
  }
}

/** The tree's depth: a name or a number is 1. a + b + c is 3 (it reads as (a + b) + c). */
export function depthOf(n: Node): number {
  switch (n.k) {
    case 'num': case 'ref': return 1
    case 'neg': case 'not': return 1 + depthOf(n.a)
    case 'arith': case 'cmp': case 'logic': return 1 + Math.max(depthOf(n.a), depthOf(n.b))
    case 'call': return 1 + Math.max(0, ...n.args.map(depthOf))
  }
}

/** round's digits: a whole number written as one, from -9 (round to billions) to 6. */
function digitsOf(n: Node): number | null {
  const v = n.k === 'num' ? n.v : n.k === 'neg' && n.a.k === 'num' ? -n.a.v : null
  return v !== null && Number.isInteger(v) && v >= -9 && v <= 6 ? v : null
}

const ARITY: Record<Fn, [number, number]> = { if: [3, 3], min: [2, 8], max: [2, 8], round: [1, 2], floor: [1, 1], ceil: [1, 1], abs: [1, 1] }

/** The type a formula has with these names in scope, or the first reason it has none. */
export function checkFormula(node: Node, names: Readonly<Record<string, Kind>>): { ok: true; type: Kind } | { ok: false; error: string } {
  class TypeErr extends Error {}
  const need = (n: Node, want: Kind, what: string): void => {
    const got = typeOf(n)
    if (got !== want) throw new TypeErr(`${what} must be ${want === 'number' ? 'a number' : 'a yes/no condition'}`)
  }
  const typeOf = (n: Node): Kind => {
    switch (n.k) {
      case 'num': return 'number'
      case 'ref': {
        if (!Object.prototype.hasOwnProperty.call(names, n.name)) throw new TypeErr(`"${n.name}" is not an input or an earlier output`)
        return names[n.name]
      }
      case 'neg': need(n.a, 'number', 'what follows a minus'); return 'number'
      case 'not': need(n.a, 'bool', 'what follows "not"'); return 'bool'
      case 'arith': need(n.a, 'number', `each side of "${n.op}"`); need(n.b, 'number', `each side of "${n.op}"`); return 'number'
      case 'cmp': need(n.a, 'number', `each side of "${n.op}"`); need(n.b, 'number', `each side of "${n.op}"`); return 'bool'
      case 'logic': need(n.a, 'bool', `each side of "${n.op}"`); need(n.b, 'bool', `each side of "${n.op}"`); return 'bool'
      case 'call': {
        const [lo, hi] = ARITY[n.fn]
        if (n.args.length < lo || n.args.length > hi) throw new TypeErr(`${n.fn} takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? '' : 's'}, not ${n.args.length}`)
        if (n.fn === 'if') {
          need(n.args[0], 'bool', "if's first argument")
          const a = typeOf(n.args[1])
          if (typeOf(n.args[2]) !== a) throw new TypeErr("if's two results must be the same type")
          return a
        }
        if (n.fn === 'round' && n.args.length === 2 && digitsOf(n.args[1]) === null) throw new TypeErr("round's digits must be a whole number from -9 to 6, written as one")
        need(n.args[0], 'number', `${n.fn}'s arguments`)
        for (const a of n.args.slice(1)) need(a, 'number', `${n.fn}'s arguments`)
        return 'number'
      }
    }
  }
  try {
    return { ok: true, type: typeOf(node) }
  } catch (e) {
    if (e instanceof TypeErr) return { ok: false, error: e.message }
    throw e
  }
}

/**
 * Half away from zero, at `digits` decimals (negative: to tens, hundreds…), without the 1.005 × 100 drift: the decimal point is
 * moved in the number's own digits. A number written with an exponent either way (below 1e-6, or 1e21 and up once moved) falls
 * back to plain arithmetic; a double that large is a whole number already (codex review, 2026-11-23: round(1e15, 6) was NaN).
 */
export function roundTo(x: number, digits = 0): number {
  const a = Math.abs(x)
  const s = String(a)
  const moved = s.includes('e') ? NaN : Number(`${s}e${digits}`)
  const r = Number.isFinite(moved) && Math.abs(moved) < 1e21 ? Number(`${Math.round(moved)}e${-digits}`) : a >= 2 ** 52 ? a : Math.round(a * 10 ** digits) / 10 ** digits
  return r === 0 ? 0 : x < 0 ? -r : r
}

const sound = (v: number): number | null => (Number.isFinite(v) && Math.abs(v) <= MAX_MAGNITUDE ? (v === 0 ? 0 : v) : null)

/**
 * A checked formula's value for these values, or null for "cannot compute" (division by zero, a non-finite or absurd number, a
 * name with no value). `if`, `and` and `or` evaluate only the side they need, so if(months > 0, total / months, 0) holds at 0.
 */
export function evaluate(node: Node, values: Readonly<Record<string, Value>>): Value | null {
  const num = (n: Node): number | null => { const v = ev(n); return typeof v === 'number' ? v : null }
  const bool = (n: Node): boolean | null => { const v = ev(n); return typeof v === 'boolean' ? v : null }
  const ev = (n: Node): Value | null => {
    switch (n.k) {
      case 'num': return n.v
      case 'ref': {
        if (!Object.prototype.hasOwnProperty.call(values, n.name)) return null
        const v = values[n.name]
        return typeof v === 'boolean' ? v : typeof v === 'number' ? sound(v) : null
      }
      case 'neg': { const a = num(n.a); return a === null ? null : sound(-a) }
      case 'not': { const a = bool(n.a); return a === null ? null : !a }
      case 'arith': {
        const a = num(n.a)
        if (a === null) return null
        const b = num(n.b)
        if (b === null) return null
        if (n.op === '/' && b === 0) return null
        return sound(n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : a / b)
      }
      case 'cmp': {
        const a = num(n.a)
        const b = num(n.b)
        if (a === null || b === null) return null
        return n.op === '<' ? a < b : n.op === '<=' ? a <= b : n.op === '>' ? a > b : n.op === '>=' ? a >= b : n.op === '==' ? a === b : a !== b
      }
      case 'logic': {
        const a = bool(n.a)
        if (a === null) return null
        if (n.op === 'and' ? !a : a) return a
        return bool(n.b)
      }
      case 'call': {
        if (n.fn === 'if') {
          const c = bool(n.args[0])
          return c === null ? null : ev(c ? n.args[1] : n.args[2])
        }
        const xs: number[] = []
        for (const a of n.fn === 'round' ? n.args.slice(0, 1) : n.args) {
          const v = num(a)
          if (v === null) return null
          xs.push(v)
        }
        switch (n.fn) {
          case 'min': return Math.min(...xs)
          case 'max': return Math.max(...xs)
          case 'round': return sound(roundTo(xs[0], n.args[1] ? digitsOf(n.args[1]) ?? 0 : 0))
          case 'floor': return sound(Math.floor(xs[0]))
          case 'ceil': return sound(Math.ceil(xs[0]))
          case 'abs': return sound(Math.abs(xs[0]))
        }
      }
    }
    return null
  }
  try {
    return ev(node)
  } catch {
    return null
  }
}

/** Every name a formula reads. */
export function namesIn(node: Node): string[] {
  const out = new Set<string>()
  const walk = (n: Node) => {
    if (n.k === 'ref') out.add(n.name)
    else if (n.k === 'neg' || n.k === 'not') walk(n.a)
    else if (n.k === 'arith' || n.k === 'cmp' || n.k === 'logic') { walk(n.a); walk(n.b) }
    else if (n.k === 'call') n.args.forEach(walk)
  }
  walk(node)
  return [...out]
}

/**
 * Arithmetic between numbers alone — (2 + 3), 100 * 7, max(3, 7) — or null. A rate built out of unit constants is still a rate
 * written into the formula (codex review, 2026-11-23), so spec.ts refuses it: every operation reads an input or an output.
 */
export function constantArithmetic(node: Node): string | null {
  const fixed = (n: Node): boolean => n.k === 'num' || (n.k === 'neg' && fixed(n.a)) || (n.k === 'arith' && fixed(n.a) && fixed(n.b)) || (n.k === 'call' && n.fn !== 'if' && fixed(n.args[0]) && (n.fn === 'round' || n.args.every(fixed)))
  let found: string | null = null
  const walk = (n: Node) => {
    if (found) return
    if ((n.k === 'arith' || (n.k === 'call' && n.fn !== 'if')) && fixed(n)) { found = n.k === 'arith' ? n.op : n.fn; return }
    if (n.k === 'neg' || n.k === 'not') walk(n.a)
    else if (n.k === 'arith' || n.k === 'cmp' || n.k === 'logic') { walk(n.a); walk(n.b) }
    else if (n.k === 'call') n.args.forEach(walk)
  }
  walk(node)
  return found
}

/** Every number written into a formula, round's digits aside (spec.ts holds them to unit constants). */
export function constantsIn(node: Node): number[] {
  const out: number[] = []
  const walk = (n: Node) => {
    if (n.k === 'num') out.push(n.v)
    else if (n.k === 'neg' || n.k === 'not') walk(n.a)
    else if (n.k === 'arith' || n.k === 'cmp' || n.k === 'logic') { walk(n.a); walk(n.b) }
    else if (n.k === 'call') (n.fn === 'round' ? n.args.slice(0, 1) : n.args).forEach(walk)
  }
  walk(node)
  return out
}
