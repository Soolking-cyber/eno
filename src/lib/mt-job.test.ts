// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listings: [] as { id: string; title: string; description: string; titleVi: string | null; descriptionVi: string | null }[],
  done: [] as { id: string; hash: string; target: string }[],
  writes: [] as unknown[][],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { findMany: async () => h.listings },
    // doneKeys' rule: every row but a machine's (a cuid, or the Gemma job's).
    translation: { findMany: async () => h.done.map(({ id, hash, target }) => ({ id, hash, target })) },
    $queryRaw: async () => h.done.filter((d) => !/^c[a-z0-9]{24}$/.test(d.id) && !d.id.startsWith('gemma1_')).map(({ hash, target }) => ({ hash, target })),
    $executeRaw: (_s: TemplateStringsArray, ...values: unknown[]) => values,
    $transaction: async (ops: unknown[][]) => { h.writes.push(...ops); return ops.map(() => 1) },
  },
}))
// Place names are spelled, never translated: here "Quận 7" alone is one.
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => w }))
vi.mock('@/lib/translate', () => ({ spelledPlace: (t: string, l: string) => (t === 'Quận 7' ? (l === 'en' ? 'District 7' : 'Quận 7') : null) }))

import { mtHash, mtJobAuthorized, mtJobToken, mtRowId, mtTodo, mtWrite, refusal, resetMtJobCacheForTests, targetsFor } from './mt-job'

const EN = 'Studio for rent near Lotte Mart, fully furnished, 8 million per month'
const VI = 'Cho thuê căn hộ studio gần Lotte Mart, đầy đủ nội thất, 8 triệu một tháng'
const listing = (id: string, title: string, description: string, titleVi: string | null = null, descriptionVi: string | null = null) =>
  ({ id, title, description, titleVi, descriptionVi })

beforeEach(() => {
  resetMtJobCacheForTests()
  h.listings = []
  h.done = []
  h.writes = []
})

describe('targetsFor', () => {
  it('an English text: every language but English', () => {
    expect(targetsFor(EN, false)).toEqual(['vi', 'zh-Hans', 'ko', 'ja', 'ru', 'km', 'ms', 'th', 'fr', 'hi'])
  })
  it('a Vietnamese text: every language but Vietnamese', () => {
    expect(targetsFor(VI, false)).toEqual(['en', 'zh-Hans', 'ko', 'ja', 'ru', 'km', 'ms', 'th', 'fr', 'hi'])
  })
  it('no Vietnamese row where every listing carries the reviewed Vietnamese column', () => {
    expect(targetsFor(EN, true)).not.toContain('vi')
  })
  it('a Korean text: English and Vietnamese too, never Korean', () => {
    const ko = '7군 스튜디오 임대, 롯데마트 근처'
    expect(targetsFor(ko, false)).toContain('en')
    expect(targetsFor(ko, false)).toContain('vi')
    expect(targetsFor(ko, false)).not.toContain('ko')
  })
})

describe('refusal', () => {
  it('passes a translation in its own script, brand names in Latin and all', () => {
    expect(refusal(EN, 'Vinhomes Central Park 스튜디오 임대, 롯데마트 근처, 풀옵션, 월 800만 동', 'ko')).toBeNull()
    expect(refusal(EN, VI, 'vi')).toBeNull()
  })
  it.each([
    ['not text', EN, 7, 'ko'],
    ['empty', EN, '  ', 'ko'],
    ['not in the target script', EN, 'Studio for rent near Lotte Mart, fully furnished', 'ko'],
    ['returned untranslated', EN, EN, 'fr'],
    ['still Vietnamese', VI, 'Cho thuê căn hộ gần Lotte Mart, nội thất đầy đủ, giá 8 triệu mỗi tháng', 'en'],
    ['not Vietnamese', EN, 'Studio for rent close to Lotte Mart, furnished, 8 million a month', 'vi'],
    ['too long', EN, 'x'.repeat(EN.length * 3 + 201), 'fr'],
    ['too short', EN.repeat(2), 'Studio', 'fr'],
    ['model artefact', EN, '```json', 'fr'],
    ['a number its source does not have', 'Call 0901 234 567 to view the studio', '전화 0901 234 568로 연락하세요', 'ko'],
    ['a number its source does not have', EN, '롯데마트 근처 스튜디오 임대, 문의 (090) 123-4567', 'ko'],
    ['a number its source does not have', EN, '롯데마트 근처 스튜디오 임대, 문의 ０９０１２３４５６７', 'ko'],
    ['a contact its source does not have', EN, '롯데마트 근처 스튜디오 임대, 자세한 내용은 zalo.me/abcxyz', 'ko'],
    ['a contact its source does not have', EN, '롯데마트 근처 스튜디오 임대, 카카오톡 abcxyz 으로 연락', 'ko'],
    ['a contact its source does not have', EN, 'Studio à louer près de Lotte Mart, écrivez à deal@scam.example', 'fr'],
    ['visa, itinerary or PayPal wording its source does not have', EN, '롯데마트 근처 스튜디오 임대, 비자 서비스 가능', 'ko'],
    ['visa, itinerary or PayPal wording its source does not have', EN, 'Студия в аренду у Lotte Mart, оформление визы, 8 млн', 'ru'],
    ['control characters', EN, '롯데마트 근처 스튜디오\u0000 임대', 'ko'],
    ['a number its source does not have', 'Studio 8.000.000đ/month', '스튜디오 월 999만 동', 'ko'],
    ['visa, itinerary or PayPal wording its source does not have', EN, '롯데마트 근처 스튜디오 임대, 여행 일정 제공', 'ko'],
    ['visa, itinerary or PayPal wording its source does not have', EN, '乐天玛特附近的工作室出租，可用贝宝付款', 'zh-Hans'],
    ['a number its source does not have', 'Studio 1.500.000đ/month', '스튜디오 월 15.000.000동', 'ko'],
    ['a number its source does not have', 'Call 0901234560 to view', '문의 09012345600', 'ko'],
    ['a contact its source does not have', EN, '롯데마트 근처 스튜디오 임대, 자세히: deals-hcm.vn', 'ko'],
    ['a contact its source does not have', EN, '롯데마트 근처 스튜디오 임대, fb.com/dealshcm', 'ko'],
    ['a number its source does not have', EN, '롯데마트 근처 스튜디오 임대, 문의 09 01 23 45 67', 'ko'],
    ['a number its source does not have', 'Studio 8 triệu/tháng, Quận 7', 'Studio 800.000đ/month, District 7', 'en'],
    ['a number its source does not have', 'Studio 8 triệu/tháng, Quận 7', 'Studio 8,000,000,000 VND/month, District 7', 'en'],
    ['a number its source does not have', 'Căn hộ 2 phòng ngủ, Quận 7', 'Apartment with 2 bedrooms, District 7, 200.000', 'en'],
    ['a number its source does not have', 'Căn hộ 1 tỷ 500 triệu', '아파트 16억 동', 'ko'],
    ['a currency its source does not have', 'Apartment 150,000,000 VND', '아파트 1억 5천만원', 'ko'],
    ['visa, itinerary or PayPal wording its source does not have', EN, 'Studio untuk disewa berhampiran Lotte Mart, 8 juta sebulan. Jadual perjalanan disediakan.', 'ms'],
    ['visa, itinerary or PayPal wording its source does not have', EN, '롯데마트 근처 스튜디오 임대, 월 800만 동, 여행 일정 제공', 'ko'],
    ['visa, itinerary or PayPal wording its source does not have', 'Studio for rent, Visa cards accepted', '스튜디오 임대, 비자 카드 가능, 비자 발급 서비스 제공', 'ko'],
    ['visa, itinerary or PayPal wording its source does not have', 'Enjoy your learning journey with me, 8 lessons', '나와 함께하는 학습 여정, 8회 수업, 여행 일정 제공', 'ko'],
    ['visa, itinerary or PayPal wording its source does not have', EN, 'Studio à louer près de Lotte Mart, itinéraire de voyage offert, 8 millions', 'fr'],
    ['returned untranslated', 'Studio Apartment District 7', 'Studio Apartment District 7', 'fr'],
    ['returned untranslated', 'Phòng trọ giá rẻ', 'Phòng trọ giá rẻ', 'en'],
  ])('%s', (why, src, value, target) => {
    expect(refusal(src, value, target as never)).toBe(why)
  })
  it('a phone number may change its separators, never its digits; a contact or visa word the source has may stay', () => {
    expect(refusal('Call 0901 234 567 to view the studio', '스튜디오 내견 문의: 0901.234.567', 'ko')).toBeNull()
    expect(refusal('Studio 8.000.000đ/month, Zalo 0901234567', '스튜디오 월 8.000.000동, Zalo 0901234567', 'ko')).toBeNull()
    expect(refusal('Studio 8.000.000đ/month', '스튜디오 월 800만 동', 'ko')).toBeNull()
    expect(refusal('Căn hộ 1.5 tỷ, 2 phòng ngủ, 2022', 'Apartment 1.5 billion, 2 bedrooms, 2022', 'en')).toBeNull()
    expect(refusal('Căn hộ 1.5 tỷ', '아파트 15억', 'ko')).toBeNull()
    expect(refusal('Căn hộ 1 tỷ 500 triệu', '아파트 15억 동', 'ko')).toBeNull()
    expect(refusal('Apartment 150,000,000 VND', '아파트 1억 5천만 동', 'ko')).toBeNull()
    expect(refusal('Studio 8 triệu/tháng', '스튜디오 월 800만 동', 'ko')).toBeNull()
    expect(refusal('Studio $500/month', '스튜디오 월 500달러', 'ko')).toBeNull()
    expect(refusal('Studio for rent, support for members', '원룸 임대, 회원 지원', 'ko')).toBeNull()
    expect(refusal('Apartment 150,000,000 VND', '公寓 1亿5千万越南盾', 'zh-Hans')).toBeNull()
    expect(refusal('Studio 8 triệu/tháng', 'Студия 8 млн донгов в месяц', 'ru')).toBeNull()
    expect(refusal('Studio 8 triệu/tháng, 30 km from the centre', 'Studio 8 million/month, 30 km from the centre', 'en')).toBeNull()
    expect(refusal('Studio for rent, Visa cards accepted', '스튜디오 임대, 비자 카드 가능', 'ko')).toBeNull()
    expect(refusal('Studio 8 triệu/tháng', 'Studio 8,000,000 VND/month', 'en')).toBeNull()
    expect(refusal('Học phí 150k/buổi', 'Fees 150k per lesson', 'en')).toBeNull()
    expect(refusal('Nguyễn Văn An', 'Nguyễn Văn An', 'fr')).toBeNull()
    expect(refusal('lina mejri', 'lina mejri', 'ms')).toBeNull()
    expect(refusal('Jose Paolo Rumbawa Aguilon', 'Jose Paolo Rumbawa Aguilon', 'ko')).toBeNull()
    expect(refusal('Nguyễn Phạm Oanh Oanh', 'Nguyễn Phạm Oanh Oanh', 'en')).toBeNull()
    expect(refusal('CHO THUÊ NHÀ QUẬN 7', 'CHO THUÊ NHÀ QUẬN 7', 'en')).toBe('returned untranslated')
    expect(refusal('CHO THUÊ NHÀ QUẬN 7', 'CHO THUÊ NHÀ QUẬN 7', 'ko')).toBe('not in the target script')
    expect(refusal('Gia sư Toán', 'Gia sư Toán', 'en')).toBe('returned untranslated')
    expect(refusal(EN, '롯데마트 근처 스튜디오 임대, Pay\u200bPal 결제, 월 800만 동', 'ko')).toBe('invisible characters')
    expect(refusal('Studio near bus route 19', 'Студия у автобусного маршрута 19', 'ru')).toBeNull()
    expect(refusal(EN, 'Студия в аренду у Lotte Mart, визовая поддержка, 8 млн донгов', 'ru')).toBe('visa, itinerary or PayPal wording its source does not have')
    expect(refusal(EN, 'ស្ទូឌីយោជួលនៅជិត Lotte Mart ទូរស័ព្ទ ០៩០១២៣៤៥៦៧', 'km')).toBe('a number its source does not have')
    expect(refusal(EN, 'Студия в аренду у Lotte Mart, 8 млн донгов, scam-deals.ru', 'ru')).toBe('a contact its source does not have')
    expect(refusal('Studio 8.5 million, near Vinhomes', 'Studio 8,5 millions, près de Vinhomes', 'fr')).toBeNull()
    expect(refusal(EN, '롯데마트 근처 스튜디오 임대, 페이 팔 결제 가능, 월 800만 동', 'ko')).toBe('visa, itinerary or PayPal wording its source does not have')
    expect(refusal('Fees 120.000 - 140.000/hour', 'Học phí 120,000-140,000/giờ', 'vi')).toBeNull()
    expect(refusal('Lương 120.000 - 140.000/giờ', 'Pay 120,000 - 140,000 per hour', 'en')).toBeNull()
    expect(refusal('Event 15-17/12/2026 in HCMC', 'Sự kiện 15/12/2026 - 17/12/2026 tại TP.HCM', 'vi')).toBeNull()
    expect(refusal("From first words to IELTS goals, you'd enjoy the journey with me", 'Từ những câu đầu tiên đến mục tiêu IELTS, bạn sẽ thích hành trình này', 'vi')).toBeNull()
    expect(refusal('Vietnam E-Visa, multiple entry', 'Visa điện tử Việt Nam, thị thực nhập cảnh nhiều lần', 'vi')).toBeNull()
    expect(refusal('Teacher of Maths — Nord Anglia Education', 'Giáo viên Toán — Nord Anglia Education', 'vi')).toBeNull()
    expect(refusal('Online classes, 1-on-1', 'Lớp học online, 1 kèm 1', 'vi')).toBeNull()
    expect(refusal('Interpreter wanted, hybrid work', 'Interpreter wanted, on-line format or in person', 'fr')).toBeNull()
    expect(refusal(EN, '롯데마트 근처 스튜디오 임대, Line ID: abcxyz', 'ko')).toBe('a contact its source does not have')
    expect(refusal('Visa support for tenants, studio near Lotte Mart', '세입자 비자 지원, 롯데마트 근처 스튜디오', 'ko')).toBeNull()
  })
  it('a malformed row is refused on its own, never failing the batch', async () => {
    h.listings = [listing('a', EN, VI)]
    const r = await mtWrite([null as never, 7 as never, { hash: mtHash(EN), target: 'fr', value: 'Studio à louer près de Lotte Mart, entièrement meublé, 8 millions par mois' }])
    expect(r.written).toBe(1)
    expect(r.rejected).toHaveLength(2)
  })
  it('a short text may come back as it is in a Latin language (a name, a model)', () => {
    expect(refusal('iPhone 15 Pro Max', 'iPhone 15 Pro Max', 'fr')).toBeNull()
  })
})

describe('mtTodo', () => {
  it('lists live texts with the languages still to do: Haiku and hand-written rows are done, a machine\'s is redone, place names skipped', async () => {
    h.listings = [listing('a', EN, VI), listing('b', 'Quận 7', EN)]
    h.done = [
      { id: mtRowId(mtHash(EN), 'ko'), hash: mtHash(EN), target: 'ko' },
      { id: 'mtfix1113_x', hash: mtHash(VI), target: 'en' },
      { id: 'gemma1_x', hash: mtHash(EN), target: 'ja' },
      { id: 'cabcdefghijklmnopqrstuvwx', hash: mtHash(EN), target: 'ru' },
      { id: 'fix_by_hand_1', hash: mtHash(EN), target: 'th' },
    ]
    const { sources, live } = await mtTodo()
    expect(live).toBe(2)
    const en = sources.find((s) => s.text === EN)!
    expect(en.listings).toBe(2)
    expect(en.targets).not.toContain('ko')
    expect(en.targets).toContain('ja')
    expect(en.targets).toContain('ru')
    expect(en.targets).not.toContain('th')
    expect(sources.find((s) => s.text === VI)!.targets).not.toContain('en')
    expect(sources.some((s) => s.text === 'Quận 7')).toBe(false)
  })
  it('a Vietnamese row is still needed when only some listings showing the text carry the reviewed column', async () => {
    h.listings = [listing('a', EN, 'x y z', 'tiêu đề'), listing('b', EN, 'x y z')]
    expect((await mtTodo()).sources.find((s) => s.text === EN)!.targets).toContain('vi')
  })
})

describe('mtWrite', () => {
  it('writes the rows that pass in one statement and refuses the rest, each with its reason', async () => {
    h.listings = [listing('a', EN, VI), listing('b', EN, 'x')]
    const r = await mtWrite([
      { hash: mtHash(EN), target: 'ko', value: '롯데마트 근처 스튜디오 임대, 풀옵션, 월 800만 동' },
      { hash: mtHash(EN), target: 'en', value: EN },
      { hash: 'f'.repeat(40), target: 'ko', value: '스튜디오' },
      { hash: mtHash(EN), target: 'ru', value: 'Studio for rent' },
      { hash: mtHash(EN), target: 'xx', value: 'x' },
    ])
    expect(r.written).toBe(1)
    expect(r.rejected.map((x) => x.why)).toEqual([
      'not a language this text needs', 'not a live listing text', 'not in the target script', 'not a language this text needs',
    ])
    expect(r.listingIds.sort()).toEqual(['a', 'b'])
    // The rows and their pages' tombstones, in one transaction: both language variants of each listing showing the text.
    expect(h.writes).toHaveLength(2)
    expect(((h.writes[1] as unknown[])[1] as string[]).sort()).toEqual([
      'eno:isrtag:_N_T_/en/listings/a', 'eno:isrtag:_N_T_/en/listings/b', 'eno:isrtag:_N_T_/vi/listings/a', 'eno:isrtag:_N_T_/vi/listings/b',
    ])
    const [ids, hashes, targets, values] = h.writes[0] as string[][]
    expect(ids).toEqual([mtRowId(mtHash(EN), 'ko')])
    expect(ids[0]).toMatch(/^haiku1_[0-9a-f]{25}$/)
    expect(hashes).toEqual([mtHash(EN)])
    expect(targets).toEqual(['ko'])
    expect(values[0]).toMatch(/^롯데마트/)
  })
  it('never overwrites a hand-written row; a machine\'s or its own it replaces', async () => {
    h.listings = [listing('a', EN, VI)]
    h.done = [
      { id: 'mtfix1113_x', hash: mtHash(EN), target: 'fr' },
      { id: 'cabcdefghijklmnopqrstuvwx', hash: mtHash(EN), target: 'ms' },
    ]
    const r = await mtWrite([
      { hash: mtHash(EN), target: 'fr', value: 'Studio à louer près de Lotte Mart, entièrement meublé, 8 millions par mois' },
      { hash: mtHash(EN), target: 'ms', value: 'Studio untuk disewa berhampiran Lotte Mart, lengkap perabot, 8 juta sebulan' },
    ])
    expect(r.written).toBe(1)
    expect(r.rejected).toEqual([{ hash: mtHash(EN), target: 'fr', why: 'a hand-written translation is kept' }])
  })
  it('writes nothing when nothing passes, and keeps the last of a repeated row', async () => {
    h.listings = [listing('a', EN, VI)]
    expect((await mtWrite([{ hash: mtHash(EN), target: 'ko', value: 'no' }])).written).toBe(0)
    expect(h.writes).toHaveLength(0)
    await mtWrite([
      { hash: mtHash(EN), target: 'fr', value: 'Studio à louer près de Lotte Mart, entièrement meublé, 8 millions par mois' },
      { hash: mtHash(EN), target: 'fr', value: 'Studio à louer près de Lotte Mart, meublé, 8 millions par mois' },
    ])
    expect((h.writes[0] as string[][])[3]).toEqual(['Studio à louer près de Lotte Mart, meublé, 8 millions par mois'])
  })
})

describe('token', () => {
  it('is off unless set to 32 characters or more, and compares the whole value', () => {
    expect(mtJobToken({})).toBeNull()
    expect(mtJobToken({ MT_JOB_TOKEN: 'short' })).toBeNull()
    const t = 'a'.repeat(40)
    expect(mtJobToken({ MT_JOB_TOKEN: t })).toBe(t)
    expect(mtJobAuthorized(`Bearer ${t}`, t)).toBe(true)
    expect(mtJobAuthorized(`Bearer ${t}x`, t)).toBe(false)
    expect(mtJobAuthorized(null, t)).toBe(false)
    expect(mtJobAuthorized('Bearer ', t)).toBe(false)
  })
})
