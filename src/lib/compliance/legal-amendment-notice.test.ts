import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AMENDED, LEGAL_AMENDMENT } from './legal-amendment'
import { AMENDMENT_NOTICE, AMENDMENT_NOTICE_ID_PREFIX, AMENDMENT_NOTICE_URL, noticeIdPrefix, noticeSendable, retractable } from './legal-amendment-notice'

/**
 * The notice to registered users (Quy chế Article 15) — the bell copy scripts/notify-legal-amendment.ts
 * writes, and when it may be written.
 */
const ROOT = join(__dirname, '..', '..', '..')

describe('the amendment notice to registered users', () => {
  it('says exactly what the site-wide strip says', () => {
    const strip = readFileSync(join(ROOT, 'src/components/marketplace/tos-change-notice.tsx'), 'utf8')
    const [en, vi] = [...strip.matchAll(/^\s*'((?:Our Terms|Điều khoản dịch vụ, Quy chế)[^']+)',$/gm)].map((m) => m[1])
    expect(en).toBeTruthy()
    expect(vi).toBeTruthy()
    expect(AMENDMENT_NOTICE.en.body).toBe(en.replace('{date}', AMENDED.inForceEn))
    expect(AMENDMENT_NOTICE.vi.body).toBe(vi.replace('{date}', AMENDED.inForceVi))
    expect(AMENDMENT_NOTICE_URL).toBe('/regulations#changelog')
    expect(strip).toContain(`href="${AMENDMENT_NOTICE_URL}"`)
  })

  it('names no site and nothing across the edition boundary — one row is read on both editions', () => {
    const all = JSON.stringify(AMENDMENT_NOTICE)
    expect(all).not.toMatch(/eno\.(vn|forum)|visa|itinerar|PayPal/i)
  })

  it('derives one id per account per amendment', () => {
    expect(AMENDMENT_NOTICE_ID_PREFIX).toBe(`legal-amendment-${LEGAL_AMENDMENT.published}-`)
  })

  it('derives the id prefix from a publication date, so a retraction can name an earlier batch', () => {
    expect(noticeIdPrefix('2026-10-01')).toBe('legal-amendment-2026-10-01-')
  })

  // ⛔ Owner, 2026-10-01: "no need for announcement" — the October 2026 amendment is immediate.
  it('is never sendable for an immediate amendment — there is no window and nothing to announce', () => {
    expect(LEGAL_AMENDMENT.immediate).toBe(true)
    for (const at of ['2026-09-30T23:00:00+07:00', '2026-10-01T00:00:00+07:00', '2026-10-01T18:00:00+07:00', '2026-10-05T00:00:00+07:00']) {
      const r = noticeSendable(new Date(at))
      expect(r.ok, at).toBe(false)
      expect(r.ok ? '' : r.reason).toContain('nothing to announce')
    }
  })

  // The default for the next amendment: a fixture with a real window (the dates 110295be shipped).
  it('with a window, may be sent only inside it, measured in Vietnam time', () => {
    const WINDOW = { published: '2026-10-01', inForce: '2026-10-07' }
    const published = Date.parse(`${WINDOW.published}T00:00:00+07:00`)
    const effective = Date.parse(`${WINDOW.inForce}T00:00:00+07:00`)
    expect(noticeSendable(new Date(published - 1), WINDOW).ok).toBe(false)
    expect(noticeSendable(new Date(published), WINDOW).ok).toBe(true)
    expect(noticeSendable(new Date(effective - 1), WINDOW).ok).toBe(true)
    // The same instant that switches the Terms version in force closes the window.
    const closed = noticeSendable(new Date(effective), WINDOW)
    expect(closed.ok).toBe(false)
    expect(closed.ok ? '' : closed.reason).toContain('notice window is over')
    expect(noticeSendable(new Date(Number.NaN), WINDOW).ok).toBe(false)
  })

  it('may be retracted only for an immediate amendment — a windowed notice is the promised announcement', () => {
    expect(retractable().ok).toBe(true)
    expect(retractable({ published: '2026-10-01', inForce: '2026-10-01', immediate: true }).ok).toBe(true)
    const windowed = retractable({ published: '2026-10-01', inForce: '2026-10-07' })
    expect(windowed.ok).toBe(false)
    expect(windowed.ok ? '' : windowed.reason).toContain('not retracting it')
  })

  // ⛔ 2026-10-01 review: `a.immediate` speaks for THIS amendment only, so --published may name only its own
  // batch sent under an earlier date (re-dated when the deploy slipped) — never another amendment's notices.
  it('retracts another date only as this amendment re-dated, 1–6 days earlier', () => {
    const NOW = { published: '2026-10-01', inForce: '2026-10-01', immediate: true } as const
    expect(retractable(NOW, '2026-10-01').ok).toBe(true)
    const redated = { published: '2026-10-03', inForce: '2026-10-03', immediate: true } as const
    for (const sent of ['2026-10-02', '2026-10-01', '2026-09-27']) expect(retractable(redated, sent).ok, sent).toBe(true)
    for (const sent of ['2026-09-26', '2026-08-01', '2026-10-04', '2027-10-03']) {
      const r = retractable(redated, sent)
      expect(r.ok, sent).toBe(false)
      expect(r.ok ? '' : r.reason, sent).toContain("another amendment's notices")
    }
    // A windowed amendment refuses whatever date is named.
    expect(retractable({ published: '2026-10-03', inForce: '2026-10-09' }, '2026-10-01').ok).toBe(false)
  })

  it('the script reads its copy, id and window from here and writes nothing without --apply', () => {
    const script = readFileSync(join(ROOT, 'scripts/notify-legal-amendment.ts'), 'utf8')
    expect(script).toContain("from '../src/lib/compliance/legal-amendment-notice'")
    expect(script).toContain('ON CONFLICT (id) DO NOTHING')
    expect(script).toContain("default_transaction_read_only=on")
    expect(script).toMatch(/if \(apply\) throw new Error\(`refusing to send: \$\{window\.reason\}`\)/)
  })

  it('refuses to send for an immediate amendment, dry run included, before touching the database', () => {
    const script = readFileSync(join(ROOT, 'scripts/notify-legal-amendment.ts'), 'utf8')
    const main = script.slice(script.indexOf('async function main()'))
    const refuse = main.indexOf('if (LEGAL_AMENDMENT.immediate) {')
    expect(refuse).toBeGreaterThan(0)
    expect(main.slice(refuse, main.indexOf('}', refuse))).toContain('throw new Error(`refusing:')
    expect(refuse).toBeLessThan(main.indexOf('new pg.Client'))
    // …but --retract is dispatched before it, since that is how the sent notices are removed.
    expect(main.indexOf("if (process.argv.includes('--retract')) return retract(url, apply)")).toBeLessThan(refuse)
  })

  it('--retract deletes exactly the rows the send mode wrote, and only on --apply', () => {
    const script = readFileSync(join(ROOT, 'scripts/notify-legal-amendment.ts'), 'utf8')
    const retract = script.slice(script.indexOf('async function retract('), script.indexOf('async function main()'))
    // The predicate is the INSERT's own shape: derived id, type 'system', the notice URL.
    expect(retract).toContain(`const MINE = \`n.id = $1 || n."recipientId"::text AND n.type = 'system' AND n.url = $2\``)
    expect(retract).toContain('DELETE FROM "Notification" n WHERE ${MINE}')
    expect(retract.match(/DELETE FROM/g)?.length).toBe(1)
    // The count runs in a read-only session unless --apply, and --apply checks retractable() first.
    expect(retract).toContain("...(apply ? {} : { options: '-c default_transaction_read_only=on' })")
    expect(retract.indexOf('if (!allowed.ok) throw new Error(`refusing to retract')).toBeLessThan(retract.indexOf('DELETE FROM'))
    // …asked about the batch it would delete (--published), not only about the current amendment.
    expect(retract).toContain('const allowed = retractable(LEGAL_AMENDMENT, published)')
    expect(retract.indexOf('if (!apply) {')).toBeLessThan(retract.indexOf('DELETE FROM'))
  })
})
