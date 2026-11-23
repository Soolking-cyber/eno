'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { fillBilingual } from '@/components/marketplace/bilingual'
import { ChoiceField, MoneyField, MonthsField, NumberField, ResultWell, regroup, useFieldPhase, useWaitingLine } from '@/components/marketplace/rent-tool-fields'
import { MAX_ONE_OFF_VND, readMoney, readMonths, type Field } from '@/lib/rent-tools/calc'
import { formatInputValue, INPUT_DECIMALS as DECIMALS } from '@/lib/tools/input-format'
import { formatOutput, runTool } from '@/lib/tools/run'
import type { ToolInput, ToolSpec } from '@/lib/tools/spec'
import { moneyLocale } from '@/lib/vnd'

/**
 * A generated tool's calculator (src/lib/tools/spec.ts), live in the reader's browser: the spec's inputs as fields, its outputs
 * computed by the formula evaluator (run.ts) — never code from the spec. Nothing typed is stored or sent. Every field starts at
 * the spec's default, which the page calls a starting value; an output that cannot be computed says so instead of a number.
 */
type Lang = 'en' | 'vi'
type Read = { read: Field<number>; message?: string }

const plain = (v: number, lang: Lang, decimals: number) =>
  new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: decimals, useGrouping: false }).format(v)

/** The starting text of a field: the default as the field would write it back. */
function startText(input: ToolInput, lang: Lang): string {
  switch (input.kind) {
    case 'money': return input.default === 0 ? '0' : regroup(input.default, lang)
    case 'choice': return String(input.default)
    default: return plain(input.default, lang, DECIMALS[input.kind])
  }
}

/** A plain number as typed: one decimal point or comma, a minus only where the range goes below 0. */
function readPlain(text: string, decimals: number): Field<number> {
  const t = (text ?? '').trim().replace('−', '-')
  if (!t) return { ok: false, error: 'empty' }
  const m = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(t)
  if (!m) return { ok: false, error: 'notNumber' }
  if ((m[3] ?? '').length > decimals) return { ok: false, error: 'notWhole' }
  return { ok: true, value: Number(`${m[1]}${m[2]}.${m[3] ?? '0'}`) }
}

export function GeneratedToolCalculator({ spec }: { spec: ToolSpec }) {
  const { tr, lang: uiLang } = useLanguage()
  const lang = moneyLocale(uiLang)
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(spec.inputs.map((i) => [i.id, startText(i, lang)])))
  const phase = useFieldPhase()
  const waiting = useWaitingLine()
  const c = (x: { en: string; vi: string }) => tr(x.en, x.vi)
  const fid = (id: string) => `tool-${id}`

  const bound = (input: ToolInput) => {
    // At the input's own precision: a range of 0.25% to 7.25% must not read "0.3% to 7.3%".
    const f = (v: number) => { const x = formatInputValue(input, v, lang); return typeof x === 'string' ? x : x[lang] }
    const en = 'Enter a value from {min} to {max}.'
    return fillBilingual(tr('Enter a value from {min} to {max}.', 'Hãy nhập giá trị từ {min} đến {max}.'), en, { min: f(input.min), max: f(input.max) })
  }
  /** The field as read, held to the spec's range; out of range, the range is what the field says. */
  const readInput = (input: ToolInput): Read => {
    const t = text[input.id] ?? ''
    let r: Field<number>
    if (input.kind === 'money') {
      // MAX_ONE_OFF_VND (100 tỷ) is spec.ts's money ceiling too, so every amount up to the input's max reads; past either, and at
      // 0 where the range starts above it, the field names the range rather than the rent tools' fixed words.
      r = readMoney(t, { optional: input.min === 0, max: MAX_ONE_OFF_VND })
      if (!r.ok && (r.error === 'zero' || r.error === 'tooLarge')) return { read: r, message: bound(input) }
    } else if (input.kind === 'months') {
      r = readMonths(t, { min: 0, max: 600, halves: true })
      if (!r.ok && r.error === 'tooLarge') return { read: r, message: bound(input) }
    }
    else if (input.kind === 'choice') r = { ok: true, value: Number(t) }
    else {
      r = readPlain(t, DECIMALS[input.kind])
      if (!r.ok) {
        const en = r.error === 'notWhole' ? 'Use at most {n} decimals.' : 'Enter a number, e.g. 12 or 1.5.'
        const said = r.error === 'notWhole' ? tr('Use at most {n} decimals.', 'Dùng tối đa {n} chữ số thập phân.') : tr('Enter a number, e.g. 12 or 1.5.', 'Hãy nhập một số, ví dụ 12 hoặc 1,5.')
        return { read: r, message: fillBilingual(said, en, { n: String(DECIMALS[input.kind]) }) }
      }
    }
    if (r.ok && (r.value < input.min || r.value > input.max)) return { read: { ok: false, error: r.value < input.min ? 'zero' : 'tooLarge' }, message: bound(input) }
    return { read: r }
  }
  const reads = spec.inputs.map((i) => ({ input: i, ...readInput(i) }))
  const values = reads.every((x) => x.read.ok) ? Object.fromEntries(reads.map((x) => [x.input.id, x.read.ok ? x.read.value : 0])) : null
  const run = values ? runTool(spec, values) : null
  const [first, ...rest] = spec.outputs
  const shown = (v: number | null | undefined, format: ToolSpec['outputs'][number]['format']) =>
    v === null || v === undefined ? tr('Cannot compute with these figures', 'Không tính được với các số này') : formatOutput(v, format, lang)

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()} aria-label={c(spec.title)}>
      <div className="grid gap-4 sm:grid-cols-2">
        {reads.map(({ input, read, message }) => {
          const id = fid(input.id)
          const common = {
            id, label: c(input.label), hint: c(input.help), value: text[input.id] ?? '', read, message,
            onChange: (v: string) => setText((s) => ({ ...s, [input.id]: v })),
            shown: phase.shown(id), onEnter: phase.onEnter(id), onLeave: phase.onLeave(id),
          }
          if (input.kind === 'money') return <MoneyField key={id} {...common} />
          if (input.kind === 'months') return <MonthsField key={id} {...common} halves />
          if (input.kind === 'choice') {
            return <ChoiceField key={id} id={id} label={common.label} hint={common.hint} value={common.value} onChange={common.onChange} choices={(input.choices ?? []).map((ch) => ({ value: String(ch.value), label: c(ch.label) }))} />
          }
          const decimals = DECIMALS[input.kind]
          return <NumberField key={id} {...common} message={message ?? ''} suffix={input.kind === 'percent' ? '%' : undefined} regroup={(v) => plain(v, lang, decimals)} />
        })}
      </div>
      <ResultWell>
        {run && first ? (
          <>
            <p className="text-base text-body">{c(first.label)}</p>
            <p className="text-t-figure text-foreground">{shown(run.outputs[first.id], first.format)}</p>
            {rest.length > 0 && (
              <dl className="mt-3 grid gap-1 text-base">
                {rest.map((o) => (
                  <div key={o.id} className="flex justify-between gap-4">
                    <dt className="text-body">{c(o.label)}</dt>
                    <dd className="text-foreground">{shown(run.outputs[o.id], o.format)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {run.notes.map((i) => <p key={i} className="mt-3 text-base font-semibold text-foreground">{c(spec.notes[i].text)}</p>)}
          </>
        ) : (
          <p className="text-base text-body">
            {waiting(tr('Fill in every figure to see the result.', 'Hãy điền đủ các ô để xem kết quả.'), reads.map(({ input, read }) => ({
              label: c(input.label), read, empty: (text[input.id] ?? '').trim() === '', shown: phase.shown(fid(input.id)),
            })))}
          </p>
        )}
      </ResultWell>
    </form>
  )
}
