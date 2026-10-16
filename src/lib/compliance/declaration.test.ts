import { describe, it, expect } from 'vitest'
import {
  DECLARATIONS, CURRENT_DECLARATION, declarationHash, buildDeclaration, verifyDeclaration,
} from './declaration'

describe('identity declaration', () => {
  it('the current version exists and states all four commitments', () => {
    const d = DECLARATIONS[CURRENT_DECLARATION]
    expect(d).toBeDefined()
    for (const n of ['(1)', '(2)', '(3)', '(4)']) {
      expect(d.vi).toContain(n)
      expect(d.en).toContain(n)
    }
  })

  it('⚠️ explicitly places legal responsibility on the declarant', () => {
    // This is the sentence the owner asked for; if it is ever edited away the declaration stops
    // doing the one job it exists to do.
    const d = DECLARATIONS[CURRENT_DECLARATION]
    expect(d.vi).toMatch(/chịu trách nhiệm trước pháp luật/)
    expect(d.en).toMatch(/full legal responsibility/i)
  })

  it('states which language governs', () => {
    // A bilingual legal declaration with no stated precedence is ambiguous exactly when it matters.
    expect(DECLARATIONS[CURRENT_DECLARATION].vi).toMatch(/giá trị pháp lý/)
    expect(DECLARATIONS[CURRENT_DECLARATION].en).toMatch(/legally binding/i)
  })

  it('cites the governing instruments', () => {
    const d = DECLARATIONS[CURRENT_DECLARATION]
    expect(d.vi).toContain('248/2026')
    expect(d.vi).toContain('122/2025')
  })

  it('hashes both languages, so locale does not change the digest', () => {
    // Otherwise the same affirmation yields different digests per user and cannot be compared.
    const h = declarationHash(CURRENT_DECLARATION)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(declarationHash(CURRENT_DECLARATION)).toBe(h) // deterministic
  })

  it('⚠️ REFUSES to record a declaration that was not affirmatively accepted', () => {
    // A record of a declaration nobody actively made is worse than no record: it is false evidence.
    expect(buildDeclaration(CURRENT_DECLARATION, false, '1.2.3.4')).toEqual({ error: 'not_accepted' })
    expect(buildDeclaration('does-not-exist', true, '1.2.3.4')).toEqual({ error: 'unknown_version' })
  })

  it('records version, hash, time and ip on acceptance', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const r = buildDeclaration(CURRENT_DECLARATION, true, '1.2.3.4', now)
    expect(r).toEqual({
      version: CURRENT_DECLARATION,
      hash: declarationHash(CURRENT_DECLARATION),
      declaredAt: now,
      ip: '1.2.3.4',
    })
  })

  it('detects text edited after the fact', () => {
    // The tampering this exists to expose: rewriting a published version retroactively changes
    // what past users are recorded as having affirmed.
    expect(verifyDeclaration({ version: CURRENT_DECLARATION, hash: declarationHash(CURRENT_DECLARATION)! })).toBe('valid')
    expect(verifyDeclaration({ version: CURRENT_DECLARATION, hash: 'deadbeef' })).toBe('text_changed')
  })

  it('⚠️ distinguishes a retired version from a tampered one', () => {
    // Collapsing these would make every historical record look forged the day a new version ships.
    expect(verifyDeclaration({ version: 'identity-v0', hash: 'whatever' })).toBe('version_retired')
  })
})

/**
 * ⛔ A PUBLISHED VERSION NEVER CHANGES — PINNED HERE, NOT ONLY PROMISED IN A COMMENT. Every identity row carries the
 * digest of the words its owner affirmed (identity_verifications.declarationHash); one edited byte in a published text
 * — a clause, a comma, the NUL separators in declaration.ts — makes every one of those records read `text_changed`,
 * i.e. forged. A new wording is a NEW id and a new line here, never an edit to an old one.
 */
const PUBLISHED: Record<string, string> = {
  'identity-v1': '1a9b09c072ac0e7cd21be506b16dfc8dabda72c66b9273abdcab542b4b6f8364', // 2026-08-03 (53f54503c)
  'identity-v2': '6559994fb51aa2bf22c1e3c5c1914503b53cb04f54f28a93aeb0f15288ce8fb7', // 2026-10-16 — clause (5), the teacher mark
}

describe('the published declarations', () => {
  it.each(Object.entries(PUBLISHED))('⛔ %s is byte for byte the text that was published', (id, digest) => {
    expect(declarationHash(id)).toBe(digest)
    expect(verifyDeclaration({ version: id, hash: digest })).toBe('valid')
  })

  it('every version in DECLARATIONS is pinned above — a new one gets its digest the day it is published', () => {
    expect(Object.keys(DECLARATIONS).sort()).toEqual(Object.keys(PUBLISHED).sort())
  })

  it('⛔ "xác minh", never "xác thực" (Decree 69/2024 reserves it) — in every published version', () => {
    for (const d of Object.values(DECLARATIONS)) expect(d.vi).not.toMatch(/xác thực/)
  })
})

/**
 * ⛔ identity-v2 (owner, 2026-10-16: "if they verify it should be auto not need to ask they consent by uploading kyc"): the
 * declaration a person affirms before uploading carries the teacher's consent to "Identity verified" being shown — the
 * mark is automatic (src/lib/teachers/identity-mark.ts), the hide is the teacher's. v1 never mentioned display; its
 * records stay valid (the owner shows that cohort too — an accepted risk, docs/compliance/pdpl-dossier-draft.md 8b).
 */
describe('identity-v2 — the "Identity verified" clause', () => {
  const v1 = DECLARATIONS['identity-v1']
  const v2 = DECLARATIONS['identity-v2']

  it('⛔ is the version every new submission affirms', () => {
    expect(CURRENT_DECLARATION).toBe('identity-v2')
    expect(v2.id).toBe('identity-v2')
    expect(v2.effective >= v1.effective).toBe(true)
  })

  it('⛔ keeps v1’s opening and clauses (1)–(4) verbatim and the binding line LAST — clause (5) is the only change', () => {
    for (const lang of ['vi', 'en'] as const) {
      const a = v1[lang].split('\n')
      const b = v2[lang].split('\n')
      expect(b).toHaveLength(a.length + 1)
      expect(b.slice(0, 5), lang).toEqual(a.slice(0, 5))
      expect(b[5], lang).toMatch(/^\(5\) /)
      expect(b[6], lang).toBe(a[5])
    }
    expect(v2.vi.split('\n').at(-1)).toBe('Bản tiếng Việt là bản có giá trị pháp lý.')
    expect(v2.en.split('\n').at(-1)).toBe('The Vietnamese text is the legally binding version.')
  })

  it('clause (5): only a teacher profile, the label, where it shows, while current, never the document, hidden at will', () => {
    const vi5 = v2.vi.split('\n')[5]
    const en5 = v2.en.split('\n')[5]
    // ⛔ No site named (commit gate, opus round 3): the profile shows on both editions, and the binding text eno.vn shows
    // must not name eno.forum — "a teacher profile" is already exactly eno's.
    expect(vi5).not.toMatch(/eno\.(vn|forum)/)
    expect(en5).not.toMatch(/eno\.(vn|forum)/)
    for (const s of [
      'Nếu tôi có hoặc tạo hồ sơ giáo viên, tôi đồng ý',
      'nhãn “Đã xác minh danh tính” được hiển thị trên hồ sơ đó',
      'trên thẻ hồ sơ trong các danh sách',
      'với những người nhắn tin cho tôi về hồ sơ',
      'khi danh tính của tôi đã được xác minh và còn hiệu lực',
      'không bao giờ hiển thị giấy tờ hay bất kỳ thông tin nào trên giấy tờ',
      'tôi có thể ẩn nhãn này bất cứ lúc nào trong hồ sơ giáo viên',
    ]) expect(vi5, s).toContain(s)
    for (const s of [
      'If I have or create a teacher profile, I agree',
      '“Identity verified” is shown on it',
      'on its card in lists',
      'to the people who message me about it',
      'while my identity is verified and current',
      'never my document or anything on it',
      'I can hide it at any time in my teacher profile',
    ]) expect(en5, s).toContain(s)
    // v1 says nothing of the kind — which is exactly why its cohort is an owner-accepted risk, not a consented one.
    expect(v1.vi).not.toContain('Đã xác minh danh tính')
    expect(v1.en).not.toContain('Identity verified')
  })

  it('⚠️ a v1 record still verifies once v2 ships — superseded is not retired, and never "tampered"', () => {
    expect(verifyDeclaration({ version: 'identity-v1', hash: PUBLISHED['identity-v1'] })).toBe('valid')
    expect(declarationHash('identity-v1')).not.toBe(declarationHash('identity-v2'))
    // A v1 record checked against v2's digest is a mismatch, not a match — the version id travels with every record.
    expect(verifyDeclaration({ version: 'identity-v1', hash: PUBLISHED['identity-v2'] })).toBe('text_changed')
  })
})
