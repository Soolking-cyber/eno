import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TRUST } from './trust-math'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

/**
 * THE PUBLIC POLICY MUST SAY WHAT THE CODE DOES (2026-09-23).
 *
 * /trust promised that a confirmed scam's penalty "stays frozen until the seller completes 5 new clean
 * deals" — deals the seller marked sold themselves, which was the exit this change removed. The page's
 * copy is a `<Tr text>` dictionary key, so it cannot interpolate the constant; this test is what ties
 * the sentence to TRUST.SCAM_RELEASE_MIN_DAYS instead, and keeps the curated Vietnamese in step.
 */
const page = readFileSync(fileURLToPath(new URL('../app/[lang]/trust/page.tsx', import.meta.url)), 'utf8')
// Built from parts on purpose: scripts/gen-ui-strings.mjs harvests `<Tr text="…">` literals from
// EVERY src file, tests included, and a literal pattern here was harvested as UI copy.
const TR_OPEN = ['<', 'Tr text="'].join('')
const sentence = page.split(TR_OPEN).map((s) => s.split('"')[0]).find((s) => s.startsWith('A confirmed scam is different:'))

describe('/trust — the scam-hold paragraph', () => {
  it('no longer promises the self-reported "clean deals" exit', () => {
    expect(page).not.toMatch(/clean deals/)
    expect(page).not.toMatch(/worked off/)
  })

  it('states the release rules with the constant the release enforces', () => {
    expect(sentence).toBeTruthy()
    expect(sentence).toContain(`${TRUST.SCAM_RELEASE_MIN_DAYS} days after the report was confirmed`)
    expect(sentence).toMatch(/neither does marking items as sold/)
    expect(sentence).toMatch(/verified their identity/)
    expect(sentence).toMatch(/written plan/)
  })

  it('has curated Vietnamese that carries the same number', () => {
    const vi = VI_OVERRIDES[sentence!]
    expect(vi).toBeTruthy()
    expect(vi).toContain(`${TRUST.SCAM_RELEASE_MIN_DAYS} ngày`)
  })
})

/**
 * THE HELP CENTER SAYS IT TOO (review, 2026-09-24). "What the trust labels mean" is a DB-backed article
 * seeded from scripts/help-center-seed.json (scripts/sync-help-center.ts writes it and its curated
 * Vietnamese) — and it still promised the "5 clean deals" exit after /trust was rewritten.
 */
describe('Help Center — "What the trust labels mean"', () => {
  const seeds = JSON.parse(readFileSync(fileURLToPath(new URL('../../scripts/help-center-seed.json', import.meta.url)), 'utf8')) as Array<Record<string, string>>
  const article = seeds.find((a) => a.slugHint === 'trust-badges-explained')!

  it('exists', () => { expect(article).toBeTruthy() })

  it('no longer promises the self-reported exit, in either language', () => {
    expect(article.body).not.toMatch(/clean deals?/i)
    expect(article.bodyVi).not.toMatch(/giao dịch sạch/)
  })

  it('states the release rule with the constant, in both languages', () => {
    expect(article.body).toContain(`no sooner than ${TRUST.SCAM_RELEASE_MIN_DAYS} days after the report was confirmed`)
    expect(article.body).toMatch(/marking items as sold does not change it/)
    expect(article.body).toMatch(/Even after a release the full penalty stays on the score/)
    expect(article.bodyVi).toContain(`${TRUST.SCAM_RELEASE_MIN_DAYS} ngày`)
    expect(article.bodyVi).toMatch(/đánh dấu đã bán/)
  })

  it('matches the /trust page sentence it summarises', () => {
    // The seed says "does not fade with time" where /trust says "waiting does nothing"; the release
    // rule itself is the same words.
    const rule = "The seller's listings stay hidden until our team releases them — no sooner than"
    expect(sentence).toContain(rule)
    expect(article.body).toContain(rule)
  })
})

