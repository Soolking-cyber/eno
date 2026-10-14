import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AMENDED, LEGAL_AMENDMENT, PROHIBITED_AMENDED, PROHIBITED_AMENDMENT } from './legal-amendment'
import {
  AMENDMENT_NOTICE, AMENDMENT_NOTICE_ID_PREFIX, AMENDMENT_NOTICE_URL, PROHIBITED_NOTICE, PROHIBITED_NOTICE_ID_PREFIX, PROHIBITED_NOTICE_PATH,
  PROHIBITED_NOTICE_URL, noticeIdPrefix, noticeSendable, retractable,
} from './legal-amendment-notice'

/**
 * The notice to registered users (Quy chế Article 15) — the bell copy scripts/notify-legal-amendment.ts
 * writes, and when it may be written.
 */
const ROOT = join(__dirname, '..', '..', '..')

describe('the amendment notice to registered users', () => {
  it('says exactly what the site-wide strip says', () => {
    const strip = readFileSync(join(ROOT, 'src/components/marketplace/tos-change-notice.tsx'), 'utf8')
    const [en, vi] = [...strip.matchAll(/^\s*'((?:Our Terms|Điều khoản dịch vụ)[^']+)',$/gm)].map((m) => m[1])
    expect(en).toBeTruthy()
    expect(vi).toBeTruthy()
    expect(AMENDMENT_NOTICE.en.body).toBe(en.replace('{date}', AMENDED.inForceEn))
    expect(AMENDMENT_NOTICE.vi.body).toBe(vi.replace('{date}', AMENDED.inForceVi))
    expect(AMENDMENT_NOTICE_URL).toBe('/terms#changes')
    expect(strip).toContain(`href="${AMENDMENT_NOTICE_URL}"`)
  })

  // The Terms' version 3 changed the Terms alone, so the copy names the Terms alone and points at their own
  // change log — not the Quy chế's, which did not change. (Version 3 is immediate, so it is never sent — below.)
  it('names the Terms of Service alone, for the Terms’ version 3, and links their change log', () => {
    expect(AMENDMENT_NOTICE.en.body).toBe(`Our Terms of Service have been amended. The changes take effect on ${AMENDED.inForceEn}.`)
    expect(AMENDMENT_NOTICE.vi.body).toBe(`Điều khoản dịch vụ đã được sửa đổi. Nội dung sửa đổi có hiệu lực từ ngày ${AMENDED.inForceVi}.`)
    expect(JSON.stringify(AMENDMENT_NOTICE)).not.toMatch(/Operating Regulations|Quy chế|Returns|đổi trả|Prohibited|cấm đăng/)
    const terms = readFileSync(join(ROOT, 'src/app/[lang]/terms/page.tsx'), 'utf8')
    expect(terms).toContain("id: 'changes',")
  })

  // With a window — version 3 as it was written, published 07/10 and in force 13/10/2026, on a fixture — the
  // copy names the in-force date, each language in its own form: what the bell would have said.
  it('with a window, says when the Terms take effect, in each language’s date form', async () => {
    const AS_WRITTEN = { published: '2026-10-07', inForce: '2026-10-13' } as const
    vi.resetModules()
    vi.doMock('./legal-amendment', async (importOriginal) => {
      const real = await importOriginal<typeof import('./legal-amendment')>()
      return { ...real, LEGAL_AMENDMENT: AS_WRITTEN, AMENDED: real.amendedDates(AS_WRITTEN) }
    })
    try {
      const { AMENDMENT_NOTICE: windowed } = await import('./legal-amendment-notice')
      expect(windowed.en.body).toBe('Our Terms of Service have been amended. The changes take effect on 13 October 2026.')
      expect(windowed.vi.body).toBe('Điều khoản dịch vụ đã được sửa đổi. Nội dung sửa đổi có hiệu lực từ ngày 13/10/2026.')
    } finally {
      vi.doUnmock('./legal-amendment')
      vi.resetModules()
    }
  })

  it('names no site and nothing across the edition boundary — one row is read on both editions', () => {
    const all = JSON.stringify(AMENDMENT_NOTICE)
    expect(all).not.toMatch(/eno\.(vn|forum)|visa|itinerar|PayPal/i)
  })

  it('derives one id per account per amendment', () => {
    expect(AMENDMENT_NOTICE_ID_PREFIX).toBe(`legal-amendment-${LEGAL_AMENDMENT.published}-`)
    expect(AMENDMENT_NOTICE_ID_PREFIX).toBe('legal-amendment-2026-10-07-')
  })

  it('derives the id prefix from a publication date, so a retraction can name an earlier batch', () => {
    expect(noticeIdPrefix('2026-10-01')).toBe('legal-amendment-2026-10-01-')
  })

  // ⛔ Owner, 2026-10-01: "no need for announcement" — the October 2026 amendment was immediate (its dates, here).
  it('is never sendable for an immediate amendment — there is no window and nothing to announce', () => {
    const OCTOBER = { published: '2026-10-01', inForce: '2026-10-01', immediate: true } as const
    for (const at of ['2026-09-30T23:00:00+07:00', '2026-10-01T00:00:00+07:00', '2026-10-01T18:00:00+07:00', '2026-10-05T00:00:00+07:00']) {
      const r = noticeSendable(new Date(at), OCTOBER)
      expect(r.ok, at).toBe(false)
      expect(r.ok ? '' : r.reason).toContain('nothing to announce')
    }
  })

  // ⛔ Owner, 2026-10-07: "Immediately (Recommended)" — the Terms' version 3 is immediate: in force on its
  // publication day, no window, no announcement, so no bell notice at any instant (its window was 07/10–12/10).
  it('is never sendable for the Terms’ version 3 — immediate, there is no window and nothing to announce', () => {
    expect(LEGAL_AMENDMENT.immediate).toBe(true)
    for (const at of ['2026-10-06T23:59:59+07:00', '2026-10-07T00:00:00+07:00', '2026-10-07T18:00:00+07:00', '2026-10-12T23:59:59+07:00', '2026-10-13T00:00:00+07:00']) {
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
    // The Terms' version 3 is immediate (owner, 2026-10-07): a notice sent under its date would name an in-force
    // date that is no longer true, and nothing replaces it — so it may be retracted.
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
    const refuse = main.indexOf('if (a.record.immediate) {')
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

  // ⛔ Owner, 2026-10-14: the e-Visa rules join eno.vn's /prohibited — "dated amendment, 5-day notice". Its own
  // record, with a window, so its notice is really sent (scripts/notify-legal-amendment.ts --record=prohibited).
  describe('the /prohibited amendment (PROHIBITED_AMENDMENT)', () => {
    it('says exactly what the strip says on eno.vn, and links the e-Visa section the amendment adds', () => {
      const strip = readFileSync(join(ROOT, 'src/components/marketplace/tos-change-notice.tsx'), 'utf8')
      const [en, vi] = [...strip.matchAll(/^\s*'((?:The list of prohibited|Danh mục hàng hóa)[^']+)',$/gm)].map((m) => m[1])
      expect(en).toBeTruthy()
      expect(vi).toBeTruthy()
      expect(PROHIBITED_NOTICE.en.body).toBe(en.replace('{date}', PROHIBITED_AMENDED.inForceEn))
      expect(PROHIBITED_NOTICE.vi.body).toBe(vi.replace('{date}', PROHIBITED_AMENDED.inForceVi))
      expect(PROHIBITED_NOTICE_PATH).toBe('/prohibited#visa-services')
      expect(strip).toContain('href={PROHIBITED_NOTICE_PATH}')
    })

    // codex, plan review: one row per account is read on BOTH editions, and eno.forum's list has carried these rules
    // since August — so the notice names eno.vn and links there, true wherever it is read.
    it('names eno.vn — the list it amends — and points there, absolute and apex; it names no service', () => {
      expect(PROHIBITED_NOTICE_URL).toBe('https://eno.vn/prohibited#visa-services')
      for (const l of ['en', 'vi'] as const) {
        expect(PROHIBITED_NOTICE[l].title).toContain('eno.vn')
        expect(PROHIBITED_NOTICE[l].body).toContain('eno.vn')
      }
      const all = JSON.stringify(PROHIBITED_NOTICE)
      expect(all).not.toMatch(/eno\.forum|www\.|visa|thị thực|itinerar|PayPal/i)
      // It names the list alone — not the Terms, the Quy chế or the privacy policy.
      expect(all).not.toMatch(/Terms|Điều khoản|Quy chế|Operating Regulations|Privacy|dữ liệu/)
    })

    it('has its own id scheme, disjoint from the Terms notices', () => {
      expect(PROHIBITED_NOTICE_ID_PREFIX).toBe(`prohibited-amendment-${PROHIBITED_AMENDMENT.published}-`)
      expect(PROHIBITED_NOTICE_ID_PREFIX.startsWith(AMENDMENT_NOTICE_ID_PREFIX)).toBe(false)
      expect(AMENDMENT_NOTICE_ID_PREFIX.startsWith(PROHIBITED_NOTICE_ID_PREFIX)).toBe(false)
    })

    it('may be sent only inside its window, in Vietnam time — and never retracted', () => {
      const published = Date.parse(`${PROHIBITED_AMENDMENT.published}T00:00:00+07:00`)
      const effective = Date.parse(`${PROHIBITED_AMENDMENT.inForce}T00:00:00+07:00`)
      expect(noticeSendable(new Date(published - 1), PROHIBITED_AMENDMENT).ok).toBe(false)
      expect(noticeSendable(new Date(published), PROHIBITED_AMENDMENT).ok).toBe(true)
      expect(noticeSendable(new Date(effective - 1), PROHIBITED_AMENDMENT).ok).toBe(true)
      expect(noticeSendable(new Date(effective), PROHIBITED_AMENDMENT).ok).toBe(false)
      expect(retractable(PROHIBITED_AMENDMENT).ok).toBe(false)
    })

    it('the script sends it with --record=prohibited, and --retract refuses it', () => {
      const script = readFileSync(join(ROOT, 'scripts/notify-legal-amendment.ts'), 'utf8')
      expect(script).toContain("const key = arg('record') ?? 'terms'")
      expect(script).toContain('record: PROHIBITED_AMENDMENT, notice: PROHIBITED_NOTICE, url: PROHIBITED_NOTICE_URL, prefix: PROHIBITED_NOTICE_ID_PREFIX,')
      const retract = script.slice(script.indexOf('async function retract('), script.indexOf('async function main()'))
      expect(retract.indexOf("if ((arg('record') ?? 'terms') !== 'terms') throw")).toBeGreaterThan(-1)
      expect(retract.indexOf("if ((arg('record') ?? 'terms') !== 'terms') throw")).toBeLessThan(retract.indexOf('new pg.Client'))
    })
  })
})
