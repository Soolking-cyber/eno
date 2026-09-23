import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TRUST } from './trust-math'
import { ENFORCEMENT } from './enforcement-machine'
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
const trTexts = page.split(TR_OPEN).map((s) => s.split('"')[0])
const sentence = trTexts.find((s) => s.startsWith('A confirmed scam is different:'))
// The release's consequence — its own <Tr> (a single key over 400 characters is not harvested for the
// machine-translated languages by scripts/gen-ui-strings.mjs).
const afterRelease = trTexts.find((s) => s.startsWith('A release does not clear the record:'))
// Owner decision 2026-09-24: posting returns after a release, capped while the charge stands.
const LIMIT = ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS

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

  it('says posting returns after a release, with the cap the publish paths enforce, and that the penalty stays', () => {
    expect(afterRelease).toBeTruthy()
    expect(afterRelease).toContain(`can post again but keep at most ${LIMIT} active listings`)
    expect(afterRelease).toMatch(/while the confirmed report stands/)
    expect(afterRelease).toMatch(/the full penalty stays on the score/)
    const vi = VI_OVERRIDES[afterRelease!]
    expect(vi).toBeTruthy()
    expect(vi).toContain(`tối đa ${LIMIT} tin đang đăng`)
  })

  it('every <Tr> key on the page stays harvestable (≤400 characters)', () => {
    for (const t of [sentence!, afterRelease!]) expect(t.length).toBeLessThanOrEqual(400)
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
    expect(article.bodyVi).toContain(`${TRUST.SCAM_RELEASE_MIN_DAYS} ngày`)
    expect(article.bodyVi).toMatch(/đánh dấu đã bán/)
  })

  it('says posting returns after a release with the cap, and that the penalty stays — in both languages', () => {
    expect(article.body).toContain(`After a release the seller can post again, but can keep at most ${LIMIT} active listings while the confirmed report stands`)
    expect(article.body).toMatch(/the full penalty stays on the score/)
    expect(article.bodyVi).toContain(`người bán có thể đăng tin trở lại nhưng chỉ được giữ tối đa ${LIMIT} tin đang đăng`)
    expect(`${article.body} ${article.bodyVi}`).not.toMatch(/may stay blocked|vẫn bị chặn/)
  })

  it('matches the /trust page sentence it summarises', () => {
    // The seed says "does not fade with time" where /trust says "waiting does nothing"; the release
    // rule itself is the same words.
    const rule = "The seller's listings stay hidden until our team releases them — no sooner than"
    expect(sentence).toContain(rule)
    expect(article.body).toContain(rule)
  })
})

/**
 * "Why a listing gets blocked" lists every refusal a seller can meet — and said a restricted account
 * "cannot post until its trust score recovers", which stopped being the whole truth when a released
 * scam hold started to waive the restricted tier (owner, 2026-09-24).
 */
describe('Help Center — "Why a listing gets blocked"', () => {
  const seeds = JSON.parse(readFileSync(fileURLToPath(new URL('../../scripts/help-center-seed.json', import.meta.url)), 'utf8')) as Array<Record<string, string>>
  const article = seeds.find((a) => a.slugHint === 'why-a-listing-gets-blocked')!

  it('names the released-hold exception and its cap, in both languages', () => {
    expect(article).toBeTruthy()
    expect(article.body).toContain(`after our team releases a scam hold, you can post again, but can keep at most ${LIMIT} active listings`)
    expect(article.bodyVi).toContain(`bạn có thể đăng tin trở lại nhưng chỉ được giữ tối đa ${LIMIT} tin đang đăng`)
  })
})

/**
 * The surfaces that word the released-charge cap outside the notice (owner decision 2026-09-24): the
 * post wizard's refusal, the admin console's release dialog and the partner/MCP sentence. Each takes
 * the number from ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS rather than retyping it.
 */
describe('the released-charge cap, where it is worded', () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('the post wizard maps the refusal to words carrying the constant', () => {
    const wizard = src('../components/marketplace/post-wizard.tsx')
    const arm = wizard.split("msg === 'released_charge_listing_cap'")[1]?.split(': msg ===')[0] ?? ''
    expect(arm).toContain('ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS')
    expect(arm).toMatch(/confirmed report stays on your record/)
  })

  it('the console release dialog says posting comes back capped — not that it may stay blocked', () => {
    const consoleSrc = src('../components/admin/enforcement-client.tsx')
    expect(consoleSrc).toContain('Posting comes back, capped')
    expect(consoleSrc).toContain('{ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS} active listings')
    expect(consoleSrc).not.toMatch(/does not give posting back/)
  })

  it('the partner API / MCP sentence names the limit and why', async () => {
    const { RELEASED_CHARGE_CAP_MESSAGE } = await import('./released-charge-copy')
    expect(RELEASED_CHARGE_CAP_MESSAGE).toContain(`at most ${LIMIT} active listings`)
    expect(RELEASED_CHARGE_CAP_MESSAGE).toMatch(/scam hold was released, but the confirmed report stays on its record/)
  })
})
