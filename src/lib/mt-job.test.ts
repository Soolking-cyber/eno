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
  // The first daily run (2026-11-14) refused 1,799 of 26,342; these are its translations, judged again.
  it('a currency is a word, not letters inside one (the first run refused 539 for that)', () => {
    const studio = 'Studio of 20 m² on Võ Oanh, Thanh My Tay Ward, Binh Thanh District'
    expect(refusal('1-bedroom apartment 30 m² · Tan Hoa Ward', '1ベッドルームのアパート 30 m²・タンホア坊', 'ja')).toBeNull()
    expect(refusal('Studio 20 m² · Bay Hien Ward, Tan Binh District', 'Студия 20 м² · фуонг Бай Хиен, район Тан Бинь', 'ru')).toBeNull()
    expect(refusal(studio, '호치민시 빈탄군 탄미떠이동 Võ Oanh 거리의 면적 20m² 원룸입니다.', 'ko')).toBeNull()
    expect(refusal('Apartment with European-style renovation', 'Квартира с евроремонтом', 'ru')).toBeNull()
    expect(refusal('2 bedrooms, round dining table', '침실 2개, 원형 식탁', 'ko')).toBeNull()
    expect(refusal('Pho and noodles served daily', 'フォーとヌードルを毎日提供', 'ja')).toBeNull()
    // …and a price moved into another currency is still refused, in these forms (fail closed: a word missing from a rule is a gap).
    for (const [src, value, target] of [['Studio, 100 a month', 'スタジオ 月100ドル', 'ja'], ['Studio, 1000 a month', 'スタジオ 1000円', 'ja'],
      ['Studio, 500 a month', 'Студия, 500 иен', 'ru'], ['Studio, 50 a month', 'Студия, 50 евро', 'ru'], ['Studio, 100 a month', 'Студия, 100 долларов', 'ru'],
      ['Studio, 100,000 a month', '원룸 월 10만원', 'ko'], ['Studio, 100 a month', '원룸 100유로', 'ko'], ['Studio, 1,000 a month', 'สตูดิโอ 1,000 บาท', 'th'],
      ['Studio, five thousand', 'สตูดิโอ ห้าพันบาท', 'th'], ['Studio, 100 a month', 'スタジオ 100ユーロ', 'ja'], ['Studio, paid monthly', 'スタジオ 日本円で支払い', 'ja'],
      ['Studio, 1,000 a month', 'สตูดิโอ ๑,๐๐๐ บาท', 'th'], ['Studio, paid monthly', 'สตูดิโอ จ่ายเป็นเงินบาท', 'th'], ['Studio, 50 a month', 'スタジオ 五十円', 'ja'],
      ['Studio, 100 a month', 'スタジオ 100ドルセール', 'ja'], ['Studio, 8,000,000 a month', '원룸 월 8,000,000원부터', 'ko'],
      ['Studio, 8,000,000 a month', '원룸 월 8,000,000원', 'ko'], ['Studio, 100 a month', 'スタジオ 月100アメリカドル', 'ja'], ['Studio, 5 a month', 'スタジオ 月五円', 'ja'],
      ['Studio, 8,000,000 a month', '원룸 월 800만원쯤', 'ko'], ['Studio, 5,000,000 a month', '원룸 500만원인데', 'ko'], ['Studio, 50,000 a month', '5만원권', 'ko'],
      ['Studio, 1000 a month', '원룸 월 천유로', 'ko'], ['Studio, 1,000 a month', 'スタジオ 1,000タイバーツ', 'ja'],
      ['Necklace for sale, 500', '500원목걸이 판매합니다', 'ko'], ['Studio, 1002 a month', '원룸 월 천이유로', 'ko'], ['Studio, 24 a month', '원룸 이십사유로', 'ko'],
      ['Studio, 10000, full amount', 'スタジオ 1万円満額', 'ja'], ['Studio, 100 a month', 'สตูดิโอ 100บาทวิถี', 'th'],
      ['Deposit: 100', 'Депозит: 100-евровый', 'ru'], ['Studio, 1 a month', '원룸 월 1경유로', 'ko'], ['Chain for sale, 100', '100ドルチェーン', 'ja'],
      ['Room, 50000 a month', '월 5만원룸', 'ko'], ['Studio, about 100', '원룸 월 100여유로', 'ko'], ['Studio, about 100', '원룸 월 백여유로', 'ko'],
      ['Studio, 100 a month', 'スタジオ 月百ドル', 'ja'], ['Chain for sale, 100', '100アメリカドルチェーン', 'ja'],
      ['Studio, 100 a month', 'สตูดิโอ 100 ยูโร', 'th'], ['Studio, 100 a month', '원룸 월 100엔', 'ko'], ['Studio, 100 a month', 'Студия, 100 йен', 'ru'],
      ['Studio, 100 a month', 'स्टूडियो, 100 यूरो', 'hi'], ['Studio, 100 a month', 'สตูดิโอ 100 เยน', 'th'],
      ['Studio, 500 a month', 'สตูดิโอ ห้าร้อยยูโร', 'th'], ['Studio, 500 a month', '원룸 월 오백엔', 'ko'], ['Studio, 500 a month', '원룸 월 오백원', 'ko'],
      ['Studio, about 100', '원룸 월 100여원', 'ko'], ['Studio, 100 a month', '원룸 월 100  엔', 'ko'], ['Studio, 100 a month', '원룸 월 100불', 'ko'],
      ['Studio, 21 a month', 'สตูดิโอ ยี่สิบเอ็ดยูโร', 'th'], ['Studio, 100 a month', '工作室 每月100美金', 'zh-Hans'], ['Studio, 100 a month', 'Студия, 100 у.е.', 'ru'],
      ['Studio, 100 a month', 'Студия, 100 рублей', 'ru'], ['Studio, 100 a month', 'स्टूडियो, 100 रुपये', 'hi'], ['Studio, 100 a month', 'Studio, RM100 sebulan', 'ms'],
      ['Studio, 1,500 a month', 'Studio, MYR 1,500 sebulan', 'ms'], ['Studio, 100 a month', '工作室 每月100元', 'zh-Hans'],
      ['Studio, 100 a month', 'स्टूडियो, 100 रुपए', 'hi'], ['Studio, 100 a month', 'Studio, Rs. 100', 'hi'], ['Studio, about 100', '工作室 每月100多元', 'zh-Hans'],
      ['Studio, 100 a month', '工作室 每月100块', 'zh-Hans'], ['Studio, about 100', '원룸 월 100여 원', 'ko'], ['Studio, 100 a month', 'สตูดิโอ 100 เหรียญ', 'th'],
      ['Studio, 100 a month', 'Studio, 100 yens par mois', 'fr'], ['Studio, 100 a month', 'Studio, 100 dolar sebulan', 'ms'], ['Studio, 100 a month', 'Studio, 100 roupies par mois', 'fr']] as const) {
      expect(refusal(src, value, target)).toBe('a currency its source does not have')
    }
  })
  it("refuses Haiku's note on Japanese room codes, not the codes", () => {
    const t = '1-bedroom apartment 30 m² · Phu Dinh Ward, District 8'
    expect(refusal(t, '1LDKではなく1ベッドルームのアパート 30 m² · フーディン区、第8区', 'ja')).toBe('a note its source does not have')
    expect(refusal(t, '1LDKのアパート 30 m² · フーディン区、第8区', 'ja')).toBeNull()
    expect(refusal(t, '1ベッドルームのアパート 30 m² · フーディン区、第8区', 'ja')).toBeNull()
  })
  it('names kept in Latin letters do not count against the script (job titles)', () => {
    expect(refusal('MYP Mathematics Teacher — Dwight School Hanoi', 'MYP 수학 교사 — Dwight School Hanoi', 'ko')).toBeNull()
    expect(refusal('MYP/DP I&S Teacher & DP ESS — Dwight School Hanoi', 'MYP/DP I&S 教师 & DP ESS — Dwight School Hanoi', 'zh-Hans')).toBeNull()
    expect(refusal('PYP Homeroom Teacher — Odyssey International School - Da Nang', 'PYP होमरूम शिक्षक — Odyssey International School - Da Nang', 'hi')).toBeNull()
    // Copied English that is not a name still counts: listing words and lower-case words are the untranslated text.
    expect(refusal('MYP Mathematics Teacher — Dwight School Hanoi', 'MYP 수학 Teacher of the school — Dwight School Hanoi', 'ko')).toBe('not in the target script')
    expect(refusal(EN, `롯데 ${EN}`, 'ko')).toBe('not in the target script')
    // A copied Title Case title with one letter of the script is still a copy.
    expect(refusal('Beautiful Family Home Near Lotte Mart', '롯데 Beautiful Family Home Near Lotte Mart', 'ko')).toBe('not in the target script')
    expect(refusal('Dwight School Hanoi Admissions Officer', '가 Dwight School Hanoi Admissions Officer', 'ko')).toBe('not in the target script')
    // …and a title half copied: its common words are not names, whatever their capitals.
    expect(refusal('Spacious Sunny Penthouse Overlooking Saigon River', '넓은 Spacious Sunny Penthouse Overlooking 사이공 강', 'ko')).toBe('not in the target script')
    expect(refusal('Cheap Room For Rent Near The Airport', '저렴한 방 For Rent Near The Airport', 'ko')).toBe('not in the target script')
    // A Vietnamese title copied: its listing words are not names (LISTING_WORDS), only the street's name is.
    const vi = 'Bán Nhà Mặt Tiền Đường Nguyễn Văn Linh Quận 7 Giá Rẻ'
    expect(refusal(vi, 'Bán Nhà Mặt Tiền Đường Nguyễn Văn Linh Quận 7 Giá 저렴', 'ko')).toBe('not in the target script')
    expect(refusal('Căn Hộ Cao Cấp Sang Trọng Full Nội Thất', '아파트 Cao Cấp Sang Trọng Full Nội Thất', 'ko')).toBe('not in the target script')
    expect(refusal('Masteri Duplex', '가 Masteri Duplex', 'ko')).toBe('not in the target script')
    expect(refusal('Can Ho Cao Cap Quan 7 Gia Re', '아파트 Cao Cap Quan 7 Gia Re', 'ko')).toBe('not in the target script')
    expect(refusal('Engine oil change', '엔진 오일 교환', 'ko')).toBeNull()
    expect(refusal('Honda Civic, 1.5 engine', '혼다 시빅, 1.5 엔진', 'ko')).toBeNull()
    expect(refusal('Backend Developer', '백엔드 개발자', 'ko')).toBeNull()
    expect(refusal('Middle School English Teacher', 'ミドルスクール英語教師', 'ja')).toBeNull()
    expect(refusal('2-bedroom unit, 100 m²', '两居室单元，100 m²', 'zh-Hans')).toBeNull()
    expect(refusal('Mát xa body, 60 phút', 'Body rub massage, 60 minutes', 'en')).toBeNull()
    expect(refusal('Join our team as a member', '우리 팀의 일원이 되세요', 'ko')).toBeNull()
  })
  it('an English text naming Vietnamese streets is its own English; a Vietnamese word in it is not', () => {
    const goplus = 'Studio of 20 m² on Nguyên Khiết, Hong Ha Ward, Hoan Kiem, Hanoi.\n\nMessage GoPlus to check availability and book a viewing.'
    expect(refusal(goplus, goplus, 'en')).toBeNull()
    const shop = 'Commercial space of 70 m² on Quốc Lộ 13, Hiep Binh Ward, Thu Duc City, Ho Chi Minh City.\n\nMessage GoPlus to check availability and book a viewing.'
    expect(refusal(shop, shop, 'en')).toBeNull()
    expect(refusal('Apple iPhone 14 Pro Max 128GB cũ 99%', 'Apple iPhone 14 Pro Max 128GB cũ 99%', 'en')).toBe('returned untranslated')
    expect(refusal('Căn Hộ Cho Thuê Quận 7 Giá Rẻ', 'Căn Hộ Cho Thuê Quận 7 Giá Rẻ', 'en')).toBe('returned untranslated')
    // Vietnamese without its marks, shouted, or Title Case is not English: no English little words in it.
    // "to", "an", "in" are Vietnamese words too, and a listing's own words capitalised are not names.
    for (const t of ['cho thue can ho Quận 7 gia re, lien he chu nha', 'CHO THUÊ CĂN HỘ GIÁ RẺ QUẬN 7', 'Bán Xe Honda Wave Đời Mới', 'BAN XE HONDA WAVE Ở QUẬN 7',
      'cho thue nha to, an ninh tot, gan truong', 'cho thue nha to Quận 7, an ninh tot, gan truong', 'Phòng Trọ Giá Rẻ for rent in the District 7',
      'Bán Nhà Mới Xây for sale in the center', 'Bán Nhà Xây for sale in the center', 'cho thue can ho gia re for rent in Quận 7']) {
      expect(refusal(t, t, 'en')).toBe('returned untranslated')
    }
    const scooter = 'Honda Lead (automatic scooter) from Blvck Motorbike in District 1. Message the shop here on eno.\n\nRent 1-2 days: 300,000 đ/day'
    expect(refusal(scooter, scooter, 'en')).toBeNull()
    // Street names made of everyday words are names (August Revolution Street; Lũy Bán Bích).
    for (const street of ['Cách Mạng Tháng Tám', 'Lũy Bán Bích']) {
      const t = `Studio of 20 m² on ${street}, Hoa Hung Ward, District 10, Ho Chi Minh City.\n\nMessage GoPlus to check availability and book a viewing.`
      expect(refusal(t, t, 'en')).toBeNull()
    }
    expect(refusal(goplus, goplus, 'fr')).toBe('returned untranslated')
    // Vietnamese with no marks at all is never asked for in English, so it never reaches this shortcut (targetsFor).
    expect(targetsFor('Phong tro gia re for rent with ban cong', false)).not.toContain('en')
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
