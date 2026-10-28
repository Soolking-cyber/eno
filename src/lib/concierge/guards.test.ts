import { beforeAll, describe, expect, it } from 'vitest'
import { EDITION_BANNED as EDITION_RULE } from '@/test/edition-words'
import { EDITION_BANNED, NOT_OFFERED_LINE, NO_PAYMENTS_LINE, NO_TRIPS_LINE, fixedLineFor, speakable } from './guards'

// The first guard call compiles every language's lists (~1 s in Node, several under the test runner): paid once here, never
// inside a test's own time limit (production pays it at the config read — i18n warmLanguageLists).
beforeAll(() => { speakable('Warm.', { teacherTurn: true, lang: 'en' }) }, 60_000)

const anyTurn = { teacherTurn: false }
const teacherTurn = { teacherTurn: true }

describe('speakable', () => {
  it("holds the one runtime copy of eno.vn's word rule to the original, character for character", () => {
    expect(EDITION_BANNED.source).toBe(EDITION_RULE.source)
    expect(EDITION_BANNED.flags).toBe(EDITION_RULE.flags)
  })

  it('lets ordinary guide sentences through — prices are not phone numbers', () => {
    for (const s of [
      'Showing teachers who can teach in District 1.',
      'Do you prefer a native English speaker, or is fluent English fine?',
      'It costs 15,000,000 dong a month.',
      'The rent is 12.000.000 ₫ a month.',
      'Most of them ask 30 to 40 million a month.',
      'Prices run from 1.080.000.000 ₫ to 2,500,000,000 dong.',
      'Showing apartments listed at 12,000,000-15,000,000 dong.',
      'A budget of 30000000 dong is set.',
      'Showing two-bedroom apartments in Thảo Điền under fifteen million dong.',
      'Showing cars from 2018-2020.',
      'Districts 10 and 11 have more rooms.',
      'Showing motorbikes for rent in District 7 with delivery.',
      'Open eno.vn/safety for tips on meeting sellers.',
      'You can make a free profile at teacher.eno.vn.',
      "I've opened https://eno.vn/hcmc-rent-index for you.",
      "I've opened the post form, goodbye for now.",
      'Your Zalo ID is shown in the chat once the seller replies.',
      'Batdongsan and Nhatot link many of these rentals.',
      NOT_OFFERED_LINE,
    ]) expect(speakable(s, teacherTurn), s).toBe(true)
  })

  it('never voices a phone number, however it is written', () => {
    for (const s of [
      'Call 0901 234 567.',
      'Call +84 90 123 4567.',
      'Call 090.123.4567.',
      'Call 0901-234-567.',
      'Text 0772007921 today.',
      'The hotline is 1900 1234.',
      'The hotline is 1800 599 920.',
      'The office line is 28 3823 4567.',
      'Call zero nine zero one two three four five six seven.',
    ]) expect(speakable(s, anyTurn), s).toBe(false)
  })

  it('never voices an email, a web address other than eno.vn pages, a handle or a chat id', () => {
    for (const s of [
      'Write to support@eno.vn.',
      'Email john at gmail dot com.',
      'See https://example.com/rooms.',
      'Check www.nhatot.com for more.',
      'It is listed on Batdongsan.com.vn.',
      'Try booking.com instead.',
      'Try nhatot dot com.',
      'eno.forum has that.',
      'Open eno.vn.example.com.',
      'Message them at zalo.me/abc.',
      'Find them @thaodien_rentals.',
      'Zalo ID: abc_123.',
      'Their Telegram username is ab_cd.',
      'Line ID abc.123 works.',
      'WhatsApp: john99.',
      'Số nhà 12 is the address.',
    ]) expect(speakable(s, anyTurn), s).toBe(false)
  })

  it("never voices a word eno.vn may not say, or a retired trust claim — decomposed Vietnamese included", () => {
    for (const s of [
      'You can get a visa there.',
      'An e-visa takes three days.',
      'Here is an itinerary.',
      'Pay with PayPal.',
      'They help with temporary residence cards.',
      'Thị thực mất ba ngày.',
      'Thị thực mất ba ngày.'.normalize('NFD'),
      'Every seller has a public trust score and bad listings get reported.',
      'eno.vn is the trusted marketplace for Vietnam.',
    ]) expect(speakable(s, anyTurn), s).toBe(false)
  })

  it('on a teacher turn, none of the counsel-pending words (NFC-normalised first); elsewhere they may pass', () => {
    for (const s of ['These foreign teachers can teach in District 1.', 'Showing teachers looking for work in Da Nang.', 'Giáo viên nước ngoài.', 'Giáo viên nước ngoài.'.normalize('NFD')]) {
      expect(speakable(s, teacherTurn), s).toBe(false)
      expect(speakable(s, anyTurn), s).toBe(true)
    }
  })

  it('a number spread over sentences is caught when the caller checks what was said with the new sentence', () => {
    const said = ['Call 0901.', '234.']
    expect(said.every((s) => speakable(s, anyTurn))).toBe(true)
    expect(speakable('567.', anyTurn)).toBe(true)
    expect(speakable([...said, '567.'].join(' '), anyTurn)).toBe(false)
  })
})

describe('fixedLineFor', () => {
  it("the fixed lines are eno's own: they pass eno.vn's word rule and the speech guard", () => {
    expect(NOT_OFFERED_LINE).toBe("eno.vn doesn't provide that service itself. Licensed providers can list in Services, and eno checks their licence first. Want me to open that section?")
    for (const line of [NOT_OFFERED_LINE, NO_TRIPS_LINE, NO_PAYMENTS_LINE]) {
      expect(line.match(EDITION_RULE)).toBeNull()
      expect(speakable(line, teacherTurn)).toBe(true)
    }
  })

  // ⛔ ONLY A VISA ASK OFFERS THE LICENSED-PROVIDERS AISLE (commit review, opus): "Do you accept PayPal?" → "yes" must never
  // land in the e-Visa aisle — trips and payments get a line of their own that offers nothing.
  it('answers an ask for a visa or residence paperwork with the offer — English or Vietnamese, accents or not', () => {
    const asks = [
      'Can you get me a visa?',
      'gia hạn visa',
      'I need a visa extension.',
      'How do I extend my visa?',
      'e-visa for my wife',
      'Do I need a visa for Vietnam?',
      'What visa do I need to teach here?',
      'Visa',
      'Can you help me with my work visa?',
      'Show me visa services in District 1',
      'i want to apply for an evisa',
      'Where can I do a border run?',
      'temporary residence card',
      'How do I get a TRC?',
      'Can I extend my stay in Vietnam?',
      'Làm visa cho người nước ngoài',
      'Tôi muốn xin visa du lịch 3 tháng',
      'Gia hạn thị thực ở đâu?',
      'gia han thi thuc o dau',
      'Thủ tục nhập cảnh',
      'Đăng ký tạm trú',
    ]
    for (const t of asks) {
      expect(fixedLineFor(t), t).toEqual({ line: NOT_OFFERED_LINE, offer: 'evisa' })
      expect(fixedLineFor(t.normalize('NFD')), `${t} (NFD)`).toEqual({ line: NOT_OFFERED_LINE, offer: 'evisa' })
    }
  })

  it('answers trip planning and PayPal with their own lines — and no offer', () => {
    const trips = [
      'plan my trip',
      'lịch trình',
      'Help me plan a 3 day trip to Da Lat',
      'Can you make an itinerary for Hanoi?',
      'Plan a tour around Hanoi for me',
      'I need a trip planner',
      'Lên kế hoạch du lịch Đà Lạt',
      'Lịch trình đi Phú Quốc 3 ngày',
    ]
    for (const t of trips) {
      expect(fixedLineFor(t), t).toEqual({ line: NO_TRIPS_LINE, offer: null })
      expect(fixedLineFor(t.normalize('NFD')), `${t} (NFD)`).toEqual({ line: NO_TRIPS_LINE, offer: null })
    }
    for (const t of ['pay with paypal', 'Do you accept PayPal?', 'pay pal']) expect(fixedLineFor(t), t).toEqual({ line: NO_PAYMENTS_LINE, offer: null })
  })

  it('never fires on an ordinary marketplace request — a side mention of a visa or a trip included', () => {
    const requests = [
      'I need a teacher in District 1',
      'căn hộ quận 2',
      'used iPhone',
      'a job in Hanoi',
      // ⚠️ DECIDED: "work permit" is not an ask it answers. The edition rule allows the words (a labour document), eno's
      // jobs page explains who applies for one, and Services has a licence-checked Legal & permits aisle the model may open.
      'work permit help',
      'Legal help with a work permit in Ho Chi Minh City',
      'Giấy phép lao động cho giáo viên',
      'Show me two bedroom apartments in Thao Dien under 15 million',
      'Tìm giáo viên tiếng Anh bản ngữ ở quận 7',
      'I want to rent a motorbike for a week',
      'Cheap furniture for my new apartment',
      'Any English teaching jobs in Saigon?',
      'Phòng trọ giá rẻ ở Bình Thạnh',
      'An eSIM with a 30 day data plan',
      'Day trip tours in Da Nang',
      'How do I post a listing?',
      'Is it safe to pay a deposit before viewing?',
      'A cleaner who comes to my place in District 7, paid hourly',
      'Native IELTS teacher for my daughter, full time',
      'Xe máy Honda cũ dưới 20 triệu',
      'A laptop for programming with 16GB RAM',
      'Việc làm giáo viên ở Đà Nẵng',
      'A room near District 3, I plan to move next month',
      "We're planning a trip so we need a car rental for a week",
      'Teaching jobs with visa sponsorship',
      'My visa ends in May, I need a six month lease',
      'Can I pay with a Visa card?',
      'Do you accept Visa or Mastercard?',
      'Giáo viên có lịch trình dạy linh hoạt',
      'Việc làm có lịch trình làm việc linh hoạt',
      'Can I tour the apartment this weekend?',
      'Can I extend my stay at the homestay?',
      'Show me the HCMC rent index',
      'A babysitter in District 2 for weekends',
      'Bàn ghế văn phòng thanh lý',
      'A cover teacher free Monday evening in District 7',
      'A lesson plan for my IELTS class',
      'Is eno.vn free to use?',
      '',
      '   ',
    ]
    for (const t of requests) expect(fixedLineFor(t), t).toBeNull()
  })
})
