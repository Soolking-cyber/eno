import { formatOutput } from './run'
import type { Copy, ToolInput } from './spec'

/**
 * A value typed into a generated tool's input, printed at the INPUT's precision — the range in a field's error and the worked
 * example's figures. Not formatOutput's: an output prints a tenth of a percent, while an input takes what spec.ts allows it
 * (7.25% stays 7.25%, a min of 0.25 stays 0.25%). Client-safe. eno.vn's own: not one of the modules Reach copies.
 */
export const INPUT_DECIMALS = { months: 1, percent: 2, number: 4 } as const

export function formatInputValue(input: Pick<ToolInput, 'kind' | 'choices'>, v: number, lang: 'en' | 'vi'): string | Copy {
  if (input.kind === 'choice') return input.choices?.find((c) => c.value === v)?.label ?? String(v)
  if (input.kind === 'money') return formatOutput(v, 'money', lang)
  const n = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: INPUT_DECIMALS[input.kind] }).format(v)
  if (input.kind === 'percent') return `${n}%`
  if (input.kind === 'months') return lang === 'vi' ? `${n} tháng` : `${n} ${v === 1 ? 'month' : 'months'}`
  return n
}
