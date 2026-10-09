import { afterEach, describe, expect, it, vi } from 'vitest'

// ⛔ EVERY TEACHER JOB-MATCH EMAIL NAMES ITS SENDER AND CAN BE STOPPED (Decree 91/2020; plan review B9/E3): on eno.vn
// the footer and the text part carry the operator's legal name and REGISTERED HEAD OFFICE (not just the city), plus the
// list's unsubscribe link. Every other email keeps its footer byte for byte. On eno.forum (no incorporated operator)
// nothing invents one.
async function load(edition: 'marketplace' | 'services') {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.resetModules()
  const { renderTeacherMatches } = await import('./teacher-matches')
  const { renderBrandEmail } = await import('./layout')
  const { COMPANY } = await import('@/lib/site-legal')
  return { renderTeacherMatches, renderBrandEmail, COMPANY }
}
afterEach(() => { vi.unstubAllEnvs() })

const UNSUB = 'https://eno.vn/unsubscribe?token=t&list=teacher-matches'
const opts = {
  jobs: [{ title: 'IELTS Instructor', city: 'Hà Nội', pay: '30M', url: 'https://eno.vn/listings/j', reasons: ['IELTS trainer'], applyAtSource: true }],
  origin: 'https://eno.vn', unsubscribeUrl: UNSUB, recipientName: 'Marco Reyes', siteName: 'eno.vn',
}

describe('renderTeacherMatches — the sender in full', () => {
  it('eno.vn: legal name (both languages) and registered head office in the HTML footer and the text part, with the unsubscribe', async () => {
    const { renderTeacherMatches, COMPANY } = await load('marketplace')
    expect(COMPANY.registered).toBe(true)
    const out = renderTeacherMatches(opts)
    expect(out.html).toContain(`${COMPANY.name} (${COMPANY.nameEn}) · ${COMPANY.address} · ${COMPANY.email}`)
    expect(out.text).toContain(`Sent by ${COMPANY.name} (${COMPANY.nameEn}) · ${COMPANY.address} · ${COMPANY.email}`)
    expect(out.html).toContain(UNSUB.replace('&', '&amp;'))
    expect(out.text).toContain(`Stop these emails: ${UNSUB}`)
    expect(out.html + out.text).not.toMatch(/visa/i)
  })

  it('eno.vn: every OTHER email keeps its footer exactly — the city only', async () => {
    const { renderBrandEmail, COMPANY } = await load('marketplace')
    const html = renderBrandEmail({ preheader: 'p', bodyHtml: '', origin: 'https://eno.vn' })
    expect(html).toContain(`${COMPANY.name} · TP. Hồ Chí Minh, Việt Nam · ${COMPANY.email}<br/>`)
    expect(html).not.toContain(COMPANY.address)
  })

  it('eno.forum: no operator invented — site name and contact only, never a "đang cập nhật" placeholder', async () => {
    const { renderTeacherMatches, COMPANY } = await load('services')
    const out = renderTeacherMatches({ ...opts, siteName: 'eno.forum' })
    expect(out.html + out.text).not.toContain('đang cập nhật')
    expect(out.text).toContain(`Sent by eno.forum · ${COMPANY.email}`)
  })
})
