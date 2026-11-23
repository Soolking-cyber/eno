'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { fillBilingual } from '@/components/marketplace/bilingual'
import { ResultWell } from '@/components/marketplace/rent-tool-fields'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseVnPrice, unitReading, vietnameseWords, type PriceNote } from '@/lib/rent-tools/vn-price'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { refusalCopy, refusalValues } from './copy'

/**
 * The converter's own lines, as authored { en, vi } pairs — so scripts/gen-ui-strings.mjs harvests the English half as the
 * source. ⚠️ NOT A `t(en, vi)` HELPER: that harvest keeps BOTH halves when both carry Vietnamese letters, and
 * "“rưỡi” adds half a {unit}" or "That is {units} đồng" do, so their Vietnamese went into the catalogue as English sources.
 */
const COPY = {
  readAs: { en: '“{input}” read as', vi: '“{input}” được hiểu là' },
  written: { en: 'Written in Vietnam: {vi}', vi: 'Viết theo kiểu Việt Nam: {vi}' },
  thatIs: { en: 'That is {units} đồng.', vi: 'Tức là {units} đồng.' },
  half: { en: '“rưỡi” adds half a {unit}.', vi: '“rưỡi” là thêm nửa {unit}.' },
  tail: { en: '{tail} after {unit} continues it: {adds} more.', vi: '{tail} sau {unit} là phần nối tiếp: thêm {adds}.' },
  literal: { en: '{tail} after {unit} is read as {adds}, as written in words. For thousands, add “nghìn”.', vi: '{tail} sau {unit} được hiểu là {adds}, như cách ghi bằng chữ. Nếu là hàng nghìn, hãy thêm “nghìn”.' },
} as const

/**
 * The live converter: how the input was read comes first, then the amount (Vietnamese grouping), then how it reads.
 * A refusal says why and, when there are two readings, names both.
 */
export function PriceConverter() {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  const d = (n: number) => formatMoneyFull(n, '₫', locale)
  const [text, setText] = useState('')
  const r = parseVnPrice(text)
  /** The amount as a Vietnamese contract writes it "bằng chữ": Vietnamese in every language, so its element says lang="vi". */
  const inWords = (n: number) => `${vietnameseWords(n)} đồng`
  const say = (c: { en: string; vi: string }, values: Record<string, string> = {}) => fillBilingual(tr(c.en, c.vi), c.en, values)

  const note = (n: PriceNote): string => {
    if (n.kind === 'bare') return tr('No unit, so it is read as đồng.', 'Không có đơn vị nên được hiểu là đồng.')
    if (n.kind === 'half') return say(COPY.half, { unit: n.unit })
    return say(n.kind === 'literal' ? COPY.literal : COPY.tail, { tail: n.tail, unit: n.unit, adds: d(n.adds) })
  }

  return (
    <form noValidate onSubmit={(e) => e.preventDefault()} aria-label={tr('Vietnamese price converter', 'Đổi giá viết tắt ra số tiền')}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pc-text" className="text-sm font-bold leading-5 text-foreground">{tr('Price as written', 'Giá cần đổi')}</Label>
        <Input
          id="pc-text"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="pc-hint"
          className="text-base"
        />
        <p id="pc-hint" className="text-t-meta text-body">{tr('For example 15tr, 1,5 tỷ, 800k, 15 triệu 500 or mười lăm triệu.', 'Ví dụ 15tr, 1,5 tỷ, 800k, 15 triệu 500 hoặc mười lăm triệu.')}</p>
      </div>
      <ResultWell>
        {r.ok ? (
          <>
            <p className="text-base text-body">{say(COPY.readAs, { input: text.trim() })}</p>
            <p className="text-t-figure text-foreground">{d(r.vnd)}{r.perMonth ? ` ${tr('a month', 'mỗi tháng')}` : ''}</p>
            {locale !== 'vi' && (
              <p className="text-base text-body">{say(COPY.written, { vi: formatMoneyFull(r.vnd, '₫', 'vi') })}</p>
            )}
            <p className="mt-2 text-base text-foreground">
              <span className="text-body">{tr('Reads:', 'Đọc là:')}</span> <span lang="vi" className="font-semibold">{inWords(r.vnd)}</span>
            </p>
            {locale !== 'vi' && <p className="text-base text-body">{say(COPY.thatIs, { units: unitReading(r.vnd, 'en') })}</p>}
            {r.notes.map((n, i) => <p key={i} className="mt-2 text-t-meta text-body">{note(n)}</p>)}
          </>
        ) : r.refusal.code === 'empty' ? (
          <p className="text-base text-body">{tr('Type a price to see the exact amount.', 'Gõ một mức giá để xem số tiền chính xác.')}</p>
        ) : (
          <p className="text-base font-semibold text-foreground" role="alert">
            {(() => {
              const c = refusalCopy(r.refusal)
              return fillBilingual(tr(c.en, c.vi), c.en, refusalValues(r.refusal, d))
            })()}
          </p>
        )}
      </ResultWell>
    </form>
  )
}
