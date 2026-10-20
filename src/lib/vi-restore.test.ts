import { describe, expect, it } from 'vitest'
import { restoreViMarks } from './vi-restore'

// The marks matter because the box model reads unaccented Vietnamese as nonsense: 'dat coc may thang' became
// "The Cock may be a staircase." These are lines a parent or a renter actually types.
describe('restoreViMarks — chat lines typed without marks', () => {
  it.each([
    ['xin chao', 'xin chào'],
    ['ban khoe khong', 'bạn khỏe không'],
    ['cam on ban nhieu', 'cảm ơn bạn nhiều'],
    ['bao nhieu tien', 'bao nhiêu tiền'],
    ['con phong khong a', 'còn phòng không ạ'],
    ['phong con trong khong', 'phòng còn trống không'],
    ['dat coc may thang', 'đặt cọc mấy tháng'],
    ['hop dong toi thieu bao lau', 'hợp đồng tối thiểu bao lâu'],
    ['lop hoc bat dau luc may gio', 'lớp học bắt đầu lúc mấy giờ'],
    ['mai minh qua xem nha duoc khong', 'mai mình qua xem nhà được không'],
    ['phong co ban cong khong', 'phòng có ban công không'],
    ['hen gap lai', 'hẹn gặp lại'],
  ])('%s → %s', (src, want) => expect(restoreViMarks(src)).toBe(want))

  it('keeps capitals, punctuation, numbers and loanwords as they are', () => {
    expect(restoreViMarks('Xin chao, phong 2 nguoi co wifi khong?')).toBe('Xin chào, phòng 2 người có wifi không?')
  })

  it('leaves words that already carry their marks alone', () => {
    expect(restoreViMarks('Bạn khỏe không')).toBe('Bạn khỏe không')
  })

  it('punctuation breaks a pair: two clauses are not read as one phrase', () => {
    // 'cam' then 'on' across a comma must not become the phrase cảm ơn
    expect(restoreViMarks('cam, on')).not.toBe('cảm, ơn')
  })
})

describe('vi-restore-data — generated tables only', () => {
  it('exports exactly UNI and BIG: unaccented keys, Vietnamese-letter values', async () => {
    const mod = await import('./vi-restore-data')
    expect(Object.keys(mod).sort()).toEqual(['BIG', 'UNI'])
    const okKey = (k: string) => /^[a-z]+( [a-z]+)?$/.test(k)
    const okValue = (v: string) => /^[\p{L}]+( [\p{L}]+)?$/u.test(v)
    expect(Object.entries(mod.UNI).filter(([k, v]) => !okKey(k) || !okValue(v))).toEqual([])
    expect(Object.entries(mod.BIG).filter(([k, v]) => !okKey(k) || !okValue(v))).toEqual([])
  })
})

describe('bán (sell) and bạn (you), đất / đặt / đắt — decided by the neighbouring word', () => {
  it.each([
    ['minh can ban xe', 'mình cần bán xe'],
    ['xe nay con dang ban khong', 'xe này còn đang bán không'],
    ['ban dat o quan 9', 'bán đất ở quận 9'],
    ['cam on ban nhieu', 'cảm ơn bạn nhiều'],
    ['ban co the gui them hinh khong', 'bạn có thể gửi thêm hình không'],
    ['dat coc truoc nhe', 'đặt cọc trước nhé'],
  ])('%s → %s', (src, want) => expect(restoreViMarks(src)).toBe(want))
})
