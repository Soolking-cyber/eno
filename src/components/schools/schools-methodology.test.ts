import { describe, expect, it } from 'vitest'
import { METHODOLOGY_ITEMS } from './schools-methodology'
import { AWARD_MIN_REVIEWS, AWARD_MIN_VOTERS, PAY_MAX_AGE_YEARS, PAY_MIN_REPORTS } from '@/lib/schools/constants'
import { PAY_BAND, PAY_ROUND_STEP } from '@/lib/schools/logic'
import { PCT_MIN_VOTES } from './school-bits'

const en = METHODOLOGY_ITEMS.map((i) => i.p.en).join('\n')
const vi = METHODOLOGY_ITEMS.map((i) => i.p.vi).join('\n')

describe('schools methodology copy', () => {
  it('states the numbers the code applies, in both languages', () => {
    expect(en).toContain(`at least ${PAY_MIN_REPORTS} teachers`)
    expect(en).toContain(`last ${PAY_MAX_AGE_YEARS} years`)
    expect(vi).toContain(`ít nhất ${PAY_MIN_REPORTS} giáo viên`)
    expect(vi).toContain(`${PAY_MAX_AGE_YEARS} năm gần nhất`)
    expect(en).toContain(`widened to the nearest ${PAY_ROUND_STEP.hour.toLocaleString('en-US')} đ an hour or ${PAY_ROUND_STEP.month.toLocaleString('en-US')} đ a month`)
    expect(vi).toContain(`${PAY_ROUND_STEP.hour.toLocaleString('vi-VN')} đ mỗi giờ hoặc ${PAY_ROUND_STEP.month.toLocaleString('vi-VN')} đ mỗi tháng`)
    expect(en).toContain(`votes from at least ${AWARD_MIN_VOTERS} teachers and at least ${AWARD_MIN_REVIEWS} reviews`)
    expect(vi).toContain(`phiếu của ít nhất ${AWARD_MIN_VOTERS} giáo viên và ít nhất ${AWARD_MIN_REVIEWS} đánh giá`)
    expect(en).toContain(`once a school has ${PCT_MIN_VOTES} votes`)
    expect(vi).toContain(`từ ${PCT_MIN_VOTES} phiếu`)
    const pct = Math.round((PAY_BAND.hi - PAY_BAND.lo) * 100)
    expect(en).toContain(`middle ${pct}%`)
    expect(vi).toContain(`${pct}% ở giữa`)
  })
  it('keeps the same placeholders in both languages', () => {
    for (const i of METHODOLOGY_ITEMS) expect(i.p.vi.match(/\{\w+\}/g) ?? []).toEqual(i.p.en.match(/\{\w+\}/g) ?? [])
  })
})
