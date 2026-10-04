import { describe, expect, it } from 'vitest'
import { PAYMENT_LURE, findPaymentLureMessageId, paymentLureKind } from './chat-safety-note'
import { fold } from '@/lib/fold'

/**
 * THE PAYMENT / DEPOSIT LURE (UX program 2, A7 item 8 — research). The counterpart asking for a transfer, a deposit, an
 * account number or a one-time code gets ONE warning under the first such incoming message.
 *
 * ⚠️ THE UNACCENTED SPELLINGS ARE THE POINT. Vietnamese typed on a phone without a Telex IME arrives with
 * no diacritics at all ("chuyen khoan truoc nhe"), and a matcher that only knew "chuyển khoản" would miss
 * the scam in exactly the hurried message it is written in.
 */
const msg = (id: string, body: string, mine = false) => ({ id, body, mine })
const lure = (body: string) => PAYMENT_LURE.test(fold(body))

describe('PAYMENT_LURE — accented, unaccented and shouted spellings are one spelling', () => {
  it.each([
    ['chuyển khoản trước nhé', 'chuyen khoan truoc nhe', 'CHUYỂN KHOẢN TRƯỚC'],
    ['bạn đặt cọc giúp mình', 'ban dat coc giup minh', 'ĐẶT CỌC 2 TRIỆU'],
    ['cọc trước 500k', 'coc truoc 500k', 'COC TRUOC'],
    ['gửi mình stk', 'gui minh stk', 'STK đây'],
    ['số tài khoản của bạn', 'so tai khoan cua ban', 'SỐ TÀI KHOẢN'],
    ['đọc giúp mình mã OTP', 'doc giup minh ma otp', 'OTP la gi'],
    ['mã xác nhận vừa gửi', 'ma xac nhan vua gui', 'ma xac thuc'],
  ])('%s / %s / %s', (a, b, c) => {
    expect(lure(a)).toBe(true)
    expect(lure(b)).toBe(true)
    expect(lure(c)).toBe(true)
  })

  it('English phrasing too: bank transfer, deposit, wire transfer / wire money', () => {
    expect(lure('Please do a bank transfer first')).toBe(true)
    expect(lure('A small deposit holds it for you')).toBe(true)
    expect(lure('Send it by wire transfer today')).toBe(true)
    expect(lure('Can you wire money to my cousin')).toBe(true)
  })

  it('does NOT fire inside other words or on ordinary chat', () => {
    expect(lure('Let us get hotpot after')).toBe(false) // otp inside a word
    expect(lure('The wireless mouse is included')).toBe(false) // wire inside a word
    expect(lure('The wire on the charger is a bit frayed')).toBe(false) // goods talk, not a payment
    expect(lure('Còn hàng không ạ?')).toBe(false)
    expect(lure('Mình qua xem lúc 5h được không?')).toBe(false)
    expect(lure('Giá có thương lượng không?')).toBe(false)
  })
})

describe('findPaymentLureMessageId — incoming only, one anchor', () => {
  it('anchors the FIRST incoming hit', () => {
    const id = findPaymentLureMessageId([
      msg('a', 'hello'),
      msg('b', 'chuyen khoan truoc di'),
      msg('c', 'gui stk nhe'),
    ])
    expect(id).toBe('b')
  })

  it('never warns the user about their own message', () => {
    expect(findPaymentLureMessageId([msg('a', 'mình chuyển khoản được không?', true)])).toBeNull()
  })

  it('a recalled message (empty body) is not a hit', () => {
    expect(findPaymentLureMessageId([msg('a', '')])).toBeNull()
  })
})

describe('paymentLureKind — the advice follows what is being paid for', () => {
  it('a room, flat or house is a rental', () => {
    expect(paymentLureKind({ categorySlug: 'rentals', subcategorySlug: 'apartment-rental', listingType: 'rent' })).toBe('rental')
    expect(paymentLureKind({ categorySlug: 'rentals', subcategorySlug: null })).toBe('rental')
  })

  it('a vehicle rental is not somewhere you view — goods advice', () => {
    expect(paymentLureKind({ categorySlug: 'rentals', subcategorySlug: 'motorbike-rental', listingType: 'rent' })).toBe('goods')
    expect(paymentLureKind({ categorySlug: 'rentals', subcategorySlug: 'car-rental' })).toBe('goods')
  })

  it('a job is never paid for (owner 2026-10-01: a job is not a sale)', () => {
    expect(paymentLureKind({ categorySlug: 'jobs', listingType: 'job' })).toBe('job')
  })

  it('a cached thread with no category falls to the general rule', () => {
    expect(paymentLureKind({ listingType: 'sell' })).toBe('goods')
    expect(paymentLureKind(null)).toBe('goods')
  })
})
