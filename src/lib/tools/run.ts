import { evaluate, parseFormula, type Node, type Value } from './expr'
import type { OutputFormat, ToolSpec } from './spec'

/**
 * A generated tool, run: its outputs in order for the values typed, and which of its notes apply. The same function prints the
 * worked example on the server, answers in the reader's browser, checks the spec's worked tests in spec.ts, and previews a draft in
 * eno Reach. Client-safe: it imports the formula language and nothing else (the validator stays off the page).
 * ⚠️ COPIED VERBATIM into eno Reach (app/api/_tool-spec/), with expr.ts, spec.ts and canonical.ts.
 */

const cache = new Map<string, Node | null>()
/** A formula's tree, read once per text. Null: it does not parse (the validator refuses such a spec before anyone sees it). */
export function formulaNode(src: string): Node | null {
  if (!cache.has(src)) {
    const p = parseFormula(src)
    if (cache.size > 500) cache.clear()
    cache.set(src, p.ok ? p.node : null)
  }
  return cache.get(src) ?? null
}

export type ToolRun = {
  /** Each output's value, or null: "cannot compute" with these figures. */
  outputs: Record<string, number | null>
  /** The indexes of the notes whose condition holds. A condition that cannot be computed does not hold. */
  notes: number[]
}

export function runTool(spec: Pick<ToolSpec, 'outputs' | 'notes'>, inputs: Readonly<Record<string, number>>): ToolRun {
  const env: Record<string, Value> = { ...inputs }
  const outputs: Record<string, number | null> = {}
  for (const o of spec.outputs) {
    const node = formulaNode(o.formula)
    const v = node ? evaluate(node, env) : null
    outputs[o.id] = typeof v === 'number' ? v : null
    // A later formula that reads an output with no value cannot compute either: the name is simply absent.
    if (typeof v === 'number') env[o.id] = v
  }
  const notes: number[] = []
  spec.notes.forEach((n, i) => {
    const node = formulaNode(n.when)
    if (node && evaluate(node, env) === true) notes.push(i)
  })
  return { outputs, notes }
}

/** What a page prints at each format's precision: whole đồng, a tenth of a percent or month, a hundredth of a number. */
export const PRINTED_UNIT: Record<OutputFormat, number> = { money: 1, percent: 0.1, months: 0.1, number: 0.01 }

/**
 * An output as the page prints it, in en or vi grouping (12,000,000 đ / 12.000.000 đ; 32.5% / 32,5%). Money is rounded to the
 * đồng, as src/lib/vnd.ts formatMoneyFull prints it (its test holds the two equal).
 */
export function formatOutput(value: number, format: OutputFormat, lang: 'en' | 'vi'): string {
  const nf = (max: number) => new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: max })
  switch (format) {
    case 'money': return `${nf(0).format(Math.round(value) || 0)} đ` // || 0: never "-0 đ"
    case 'percent': return `${nf(1).format(value)}%`
    case 'months': return lang === 'vi' ? `${nf(1).format(value)} tháng` : `${nf(1).format(value)} ${value === 1 ? 'month' : 'months'}`
    case 'number': return nf(2).format(value)
  }
}
