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
import { CARD_APPROX, CARD_BODY, CARD_LINE_PX, CARD_META, CARD_PRICE, CARD_WAS, TEACHER_TITLE_LINE, TITLE_LINE } from './card-text'

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
      expect(src, name).toContain('className={CARD_BODY}')
      expect(src, name).not.toContain('"flex flex-1 flex-col gap-0.5 px-2 pt-2 sm:px-0.5"')
    }
    expect(CARD_BODY).toBe('flex flex-1 flex-col gap-0.5 px-2 pt-2.5 sm:px-0.5')
  })

  it('the skeleton bars are the roles\' line boxes: price 22, title 20, meta 18', () => {
    expect(linePx('price')).toBe(CARD_LINE_PX.price)
    expect(linePx('card')).toBe(CARD_LINE_PX.title)
    expect(linePx('meta')).toBe(CARD_LINE_PX.meta)
    expect(SKELETON).toContain(`<Skeleton className="h-[${CARD_LINE_PX.price}px] w-1/2" />`)
    expect(SKELETON).toContain('<Skeleton className="h-5 w-4/5" />') // 20px
    expect(SKELETON).toContain(`<Skeleton className="mt-0.5 h-[${CARD_LINE_PX.meta}px] w-1/2 lg:h-5" />`)
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

  it('a teacher keeps the name bold and in ink (owner, 2026-11-12, kept)', () => {
    const cls = TEACHER_TITLE_LINE.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['truncate', 'text-base', 'font-bold', 'leading-snug', 'sm:text-lg', 'text-foreground']))
    expect(cls).not.toContain('text-t-card')
    expect(cls).not.toContain('text-ink-3')
    expect(cls).not.toContain('font-normal')
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
