/**
 * THE CARD TEXT BLOCK IS WRITTEN ONCE (owner-approved 2026-11-14, cook r05; src/lib/card-text.ts). The card, the SEO tile and the
 * skeleton read the same strings, and the skeleton's bars are the line boxes of the type roles the card prints — so a role
 * that changes its size without the bars is a layout shift on every card that lands. Read as source and as CSS: the
 * rendered pins live in listing-card.teacher-order.test.tsx, seo-listing-rail.browse-link.test.tsx and
 * listing-card-skeleton.test.tsx.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_APPROX, CARD_BODY, CARD_LINE_PX, CARD_META, CARD_PRICE, CARD_WAS, TEACHER_BODY, TEACHER_NO_RATE, TEACHER_PROOF, TEACHER_RATE, TEACHER_RATE_UNIT, TEACHER_TITLE_LINE, TITLE_LINE, WIDE_BODY, WIDE_LINE_PX, WIDE_META, WIDE_PRICE_ROW, WIDE_TITLE } from './card-text'
import { cn } from './utils'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const CSS = read('src/app/globals.css')
const CARD = read('src/components/marketplace/listing-card.tsx')
const SEO = read('src/components/marketplace/seo-listing-rail.tsx')
const SKELETON = read('src/components/marketplace/listing-card-skeleton.tsx')

/** A role's line height in px, from `@theme { --text-t-<role>--line-height: Nrem }`. */
const linePx = (role: string) => {
  const m = CSS.match(new RegExp(`--text-t-${role}--line-height:\\s*([\\d.]+)rem;`))
  expect(m, role).not.toBeNull()
  return Number(m![1]) * 16
}

describe('card-text — one block for the card, the SEO tile and the skeleton', () => {
  it('the card, the SEO tile and the skeleton import the ONE CARD_BODY, and none spells the body out by hand', () => {
    for (const [name, src] of [['card', CARD], ['seo', SEO], ['skeleton', SKELETON]] as const) {
      expect(src, name).toMatch(/import \{[^}]*\bCARD_BODY\b[^}]*\} from '@\/lib\/card-text'/)
      // The body IS CARD_BODY — bare, or merged with a surface's phone-only variant (a home lane's flush text, the wide rental card).
      expect(src, name).toMatch(/className=\{(?:CARD_BODY|[^}]*\bcn\(CARD_BODY, [^}]*)\}/)
      expect(src, name).not.toContain('"flex flex-1 flex-col gap-0.5 px-2 pt-2 sm:px-0.5"')
    }
    expect(CARD_BODY).toBe('flex flex-1 flex-col gap-0.5 px-2 pt-2.5 sm:px-0.5')
  })

  it('the skeleton bars are the roles\' line boxes: price 22, title 20, meta 18', () => {
    expect(linePx('price')).toBe(CARD_LINE_PX.price)
    expect(linePx('card')).toBe(CARD_LINE_PX.title)
    expect(linePx('meta')).toBe(CARD_LINE_PX.meta)
    expect(SKELETON).toContain(`<Skeleton className="h-[${CARD_LINE_PX.price}px] w-1/2" />`)
    // 20px — the wide card's skeleton swaps in its own 24px bar below sm only (2026-11-14, `wide`).
    expect(SKELETON).toMatch(/<Skeleton className=(?:"h-5 w-4\/5"|\{wide \? 'h-5 w-4\/5 [^']*' : 'h-5 w-4\/5'\}) \/>/)
    // The META bar under the row's pt-0.5 — and, on a teacher cell, with none (the teacher info line is top-aligned, 2026-11-14).
    expect(SKELETON).toContain(`'mt-0.5 h-[${CARD_LINE_PX.meta}px] w-1/2 lg:h-5'`)
  })

  it('each string carries its role, and nothing in the block is under the 13px meta role', () => {
    expect(CARD_PRICE).toBe('text-t-price')
    expect(TITLE_LINE).toContain('text-t-card')
    expect(TITLE_LINE).toContain('truncate')
    expect(TITLE_LINE).toContain('text-ink-3')
    // The VI stacked-mark room: 1px of padding above the clip edge, given back by the margin — the box model nets to 0.
    expect(TITLE_LINE.split(' ')).toEqual(expect.arrayContaining(['-mt-px', 'pt-px']))
    expect(TEACHER_TITLE_LINE.split(' ')).toEqual(expect.arrayContaining(['-mt-px', 'pt-px']))
    expect(CARD_META).toContain('text-t-meta')
    expect(CARD_META).toContain('pt-0.5')
    expect(CARD_APPROX).toContain('text-t-meta')
    expect(CARD_WAS).toContain('text-t-meta')
    for (const s of [CARD_BODY, CARD_PRICE, CARD_APPROX, TITLE_LINE, CARD_META, CARD_WAS]) expect(s).not.toMatch(/\btext-(?:xs|2xs|3xs)\b/)
  })

  it('a teacher keeps the name bold and in ink (owner, 2026-11-12, kept) — the h3 role on a phone, 18 from sm (2026-11-14)', () => {
    const cls = TEACHER_TITLE_LINE.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['truncate', 'text-t-h3', 'font-bold', 'max-sm:tracking-tight', 'sm:text-lg', 'sm:leading-snug', 'text-foreground']))
    expect(cls).not.toContain('text-t-card')
    expect(cls).not.toContain('text-ink-3')
    expect(cls).not.toContain('font-normal')
    expect(linePx('h3')).toBe(24)
    // Build 7 (owner-approved 2026-11-15, cook r07 teachers): the rate 16/22 bold on a phone (16/20 from sm), its unit a 13 muted
    // label, "Rate on request" 14/22 regular on a phone (16/20 bold from sm); the proof 14/20 ink-2 — nothing under 13px.
    expect(TEACHER_RATE.split(' ')).toEqual(['text-base', 'leading-5.5', 'font-bold', 'sm:leading-5'])
    expect(TEACHER_NO_RATE.split(' ')).toEqual(['text-sm', 'leading-5.5', 'font-normal', 'sm:text-base', 'sm:leading-5', 'sm:font-bold'])
    expect(TEACHER_RATE_UNIT.split(' ')).toEqual(['max-sm:text-t-meta', 'max-sm:font-normal', 'max-sm:text-muted-foreground'])
    expect(TEACHER_PROOF.split(' ')).toEqual(['truncate', 'text-sm', 'text-body'])
    // The text block keeps CARD_BODY's left inset and runs to the photo's right edge on a phone.
    expect(cn(CARD_BODY, TEACHER_BODY).split(' ')).toEqual(expect.arrayContaining(['px-2', 'max-sm:pr-0', 'sm:px-0.5']))
  })

  it('the card no longer paints a blurred fill under its photo, nor a "Just in" chip', () => {
    expect(CARD).not.toContain('<PhotoFill')
    expect(CARD).not.toContain("'object-contain'")
    expect(SEO).not.toContain('<PhotoFill')
    expect(CARD).not.toContain('showNew=')
    expect(CARD).not.toContain('chipInHtml=')
    expect(read('src/components/marketplace/card-badges.tsx')).not.toContain("tr('Just in'")
  })
})

/**
 * ⛔ THE WIDE PHONE CARD'S BLOCK (owner-approved 2026-11-14, cook r06 rentals-a — card-text.ts WIDE_*, listing-card.tsx `wide`): every
 * class is phone-only, and its one-line body is the 88px the skeleton and the feed's unrendered guess reserve (96 until build 8 —
 * owner-approved 2026-11-15, cook r08 rentals — moved the check out of the price row onto the photo).
 */
describe('card-text — the wide phone card', () => {
  it('every WIDE_* class is max-sm:, so from sm the card is the grid card', () => {
    for (const s of [WIDE_BODY, WIDE_TITLE, WIDE_META, WIDE_PRICE_ROW]) for (const t of s.split(' ')) expect(t).toMatch(/^max-sm:/)
  })

  it('the body is CARD_BODY\'s one column, flush, 12px under the photo; the price row 28px; the title the body role in ink; the meta 14/20', () => {
    expect(WIDE_BODY.split(' ')).toEqual(['max-sm:px-0', 'max-sm:pt-3'])
    expect(CARD_BODY.split(' ')).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-0.5']))
    expect(WIDE_PRICE_ROW.split(' ')).toEqual(['max-sm:min-h-7', 'max-sm:content-center'])
    expect(WIDE_TITLE.split(' ')).toEqual(['max-sm:text-base', 'max-sm:leading-6', 'max-sm:text-foreground'])
    expect(WIDE_META.split(' ')).toEqual(['max-sm:pt-0', 'max-sm:text-sm'])
    // No grid and no column spans are left over from the two-column body (build 7).
    for (const s of [WIDE_BODY, WIDE_TITLE, WIDE_META]) expect(s).not.toMatch(/grid|col-span/)
  })

  it('a one-line wide body is 88px, and the feed guesses an unrendered wide cell at 100vw − 24 + 88', () => {
    const { top, row, title, meta, gap } = WIDE_LINE_PX
    expect(row).toBe(28)
    expect(top + row + gap + title + gap + meta).toBe(88)
    expect(CSS).toContain('[data-feed-card][data-wide-cell] { contain-intrinsic-size: auto calc(100vw + 64px); }')
    // The skeleton's wide bars: the 22px price bar centred in the 28px row (no slot row), the 24px title, the 20px meta.
    expect(SKELETON).not.toContain('min-h-9 sm:hidden')
    // (The goods skeleton's price bar left this branch in build 8: its card ends on the price — listing-card.goods.test.tsx.)
    expect(SKELETON).toContain('{wide ? <Skeleton className="h-[22px] w-1/2 max-sm:my-0.75" />')
    expect(SKELETON).toContain("'h-5 w-4/5 max-sm:h-6'")
    expect(SKELETON).toContain("'mt-0.5 h-[18px] w-1/2 lg:h-5 max-sm:mt-0 max-sm:h-5'")
  })
})
