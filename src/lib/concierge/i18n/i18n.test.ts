import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EN_LINES, LANGUAGE_NAMES, SPOKEN_LANGUAGES, digitize, digitizeRuns, entryRegex, i18nAsk, i18nUnspeakable, isI18nYes, isTeacherTalkI18n, linesFor, norm, spokenLanguage, warmLanguageLists, type SpokenLanguage } from './index'
import { EN_SPEECH_BAN, LEXICON } from './lexicon'
import { EN_CASES, LEXICON_CASES } from './lexicon-cases'
import { fixedLineFor, speakable, spokenDigits } from '../guards'

// The first guard call compiles every language's lists (~1 s in Node, several under the test runner): paid once here, never
// inside a test's own time limit (production pays it at the config read — i18n warmLanguageLists).
beforeAll(() => { speakable('Warm.', { teacherTurn: true, lang: 'en' }) }, 60_000)

/**
 * The guide in nine more languages (index.ts). The sentences are the verifiers' OWN (lexicon-cases.ts — never the drafters'
 * examples), run here against the module as production compiles it: every language's asks together, and every sentence of
 * the guide screened by every language's lists.
 */
const OTHER = SPOKEN_LANGUAGES.filter((l): l is Exclude<SpokenLanguage, 'en'> => l !== 'en')
// Thousands of corpus sentences through the WHOLE guard per test: seconds on a busy machine (measured 2026-10-29, load ~45:
// one file 5 s past vitest's default) — a time limit for the machine, not for the guard (its own speed tests are below).
vi.setConfig({ testTimeout: 60_000 })

describe('spokenLanguage — the app\'s language as the guide speaks it', () => {
  it('the ten Soniox speaks; Khmer (and anything else) is English', () => {
    for (const l of SPOKEN_LANGUAGES) expect(spokenLanguage(l)).toBe(l)
    for (const l of ['km', '', null, undefined, 'xx', 'en-GB']) expect(spokenLanguage(l)).toBe('en')
    // ⛔ eno's own codes (src/lib/languages.ts): its Chinese is zh-Hans — Soniox's zh
    expect(spokenLanguage('zh-Hans')).toBe('zh')
    expect(spokenLanguage('vi-VN')).toBe('vi')
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...SPOKEN_LANGUAGES].sort())
  })
})

describe.each(OTHER)('%s', (lang) => {
  const c = LEXICON_CASES[lang]
  const L = linesFor(lang)

  it('every fixed line is speakable in its language (a teacher turn\'s screen too), and asks where the English asks', () => {
    const lines = [L.refused, L.partial, L.moved, L.empty, L.emptyAfter, L.emptyChip, L.rateEmpty, L.rateFallback, ...L.looking, L.opening, L.notOffered, L.noTrips, L.noPayments, L.offerYes, L.offerNo, L.offerTaken]
    for (const s of lines) expect(speakable(s, { teacherTurn: true, lang }), s).toBe(true)
    for (const k of ['refused', 'partial', 'moved', 'empty', 'rateEmpty', 'rateFallback', 'notOffered'] as const) {
      expect(EN_LINES[k].trim().endsWith('?'), k).toBe(true)
      expect(L[k].trim(), `${lang}.${k}`).toMatch(/[?？]$/)
    }
    expect(L.emptyAfter.trim(), 'emptyAfter offers — never a second question').not.toMatch(/[?？]$/)
    expect(L.looking).toHaveLength(3)
  })

  it('asks for a visa, a trip plan or PayPal → that fixed line', () => {
    for (const s of c.asks.visa) expect(i18nAsk(s), s).toBe('visa')
    for (const s of c.asks.trip) expect(i18nAsk(s), s).toBe('trip')
    for (const s of c.asks.pay) expect(i18nAsk(s), s).toBe('pay')
  })

  it('a MENTION is no ask (a visa-sponsored job, "my visa ends, I need a lease", one\'s own trip plans), and the card network is never a visa', () => {
    for (const s of c.mentions) expect(['visa', 'trip'], s).not.toContain(i18nAsk(s))
    for (const s of c.card) expect(i18nAsk(s), s).not.toBe('visa')
  })

  it('⛔ the guide offering a banned service in disguise is never said; its ordinary sentences are (the whole guard — English and Vietnamese rules included)', () => {
    for (const s of c.offers) expect(speakable(s, { teacherTurn: false, lang }), s).toBe(false)
    for (const s of c.ordinary) expect(speakable(s, { teacherTurn: false, lang }), s).toBe(true)
    for (const s of c.teacherOrdinary) expect(speakable(s, { teacherTurn: true, lang }), s).toBe(true)
  })

  it('the fixed line for an ask is in the language the guide speaks; a visa ask offers the licensed-providers aisle, the others nothing', () => {
    const visa = fixedLineFor(c.asks.visa[0], lang)
    expect(visa).toEqual({ line: L.notOffered, offer: 'evisa' })
    expect(fixedLineFor(c.asks.trip[0], lang)).toEqual({ line: L.noTrips, offer: null })
    expect(fixedLineFor(c.asks.pay[0], lang)).toEqual({ line: L.noPayments, offer: null })
  })

  it('the offer\'s chips: "Yes, open it" is a yes, "No, thanks" never', () => {
    expect(isI18nYes(L.offerYes)).toBe(true)
    expect(isI18nYes(L.offerNo)).toBe(false)
  })
})

describe('⛔ a guide that drifts into another language is screened all the same (commit review, codex + opus)', () => {
  it('a visa offer in Japanese or Korean is never said on an English or a French turn', () => {
    expect(speakable('空港でアライバルビザが取れますよ。', { teacherTurn: false, lang: 'en' })).toBe(false)
    expect(speakable('도착 비자를 받으시면 돼요.', { teacherTurn: false, lang: 'fr' })).toBe(false)
    expect(speakable('我可以帮你办理签证。', { teacherTurn: false, lang: 'en' })).toBe(false)
  })

  it('every language\'s ordinary sentences pass on an English turn too (no list hits another language\'s everyday words)', () => {
    for (const lang of OTHER) for (const s of LEXICON_CASES[lang].ordinary) expect(speakable(s, { teacherTurn: false, lang: 'en' }), `${lang}: ${s}`).toBe(true)
  })

  it('no pattern carries an upper-case literal (the text is lower-cased and the lists run without the i flag)', async () => {
    const { LEXICON } = await import('./lexicon')
    for (const [l, L] of Object.entries(LEXICON)) {
      for (const e of [...L.speechBan, ...L.counselWords, ...Object.values(L.asks).flat()]) {
        expect(e.pattern.replace(/\\[pP]\{[^}]*\}|\\[A-Za-z]/g, ''), `${l}: ${e.pattern}`).not.toMatch(/[A-Z\u00C0-\u00DE\u0410-\u042F]/u)
      }
    }
  })
})

describe('⛔ the guide OFFERING to plan a trip or arrange a tour — English too (offer lists, 2026-10-29)', () => {
  it('every verified English offer is never said, and every ordinary English sentence is (EN_SPEECH_BAN, beside EDITION_BANNED)', () => {
    const missed = EN_CASES.offers.filter((s) => speakable(s, { teacherTurn: false, lang: 'en' }))
    const dropped = EN_CASES.ordinary.filter((s) => !speakable(s, { teacherTurn: false, lang: 'en' }))
    expect({ missed, dropped }).toEqual({ missed: [], dropped: [] })
    expect(EN_CASES.offers.length).toBeGreaterThan(300)
  })

  it('⚡ no entry backtracks: each one on 120 words of its language\'s own vocabulary, and on a run of one word, in under 200 ms (backtracking takes seconds; a slow CI runner never 200)', () => {
    const lists = [
      { entries: EN_SPEECH_BAN, texts: [...EN_CASES.offers, ...EN_CASES.ordinary] },
      ...OTHER.map((l) => ({ entries: [...LEXICON[l].speechBan, ...LEXICON[l].counselWords, ...Object.values(LEXICON[l].asks).flat()], texts: [...LEXICON_CASES[l].offers, ...LEXICON_CASES[l].ordinary] })),
    ]
    const slow: string[] = []
    // Every language's words mixed too (commit review round 3, opus: each list runs on every sentence, in any language).
    const every = [...new Set(lists.flatMap((x) => x.texts).map(norm).join(' ').split(' ').filter(Boolean))]
    for (const { entries, texts } of lists) {
      const vocab = [...new Set(texts.map(norm).join(' ').split(' ').filter(Boolean))]
      let seed = 7
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
      const inputs = [
        ...Array.from({ length: 8 }, () => Array.from({ length: 120 }, () => vocab[Math.floor(rnd() * vocab.length)]).join(' ')),
        ...Array.from({ length: 4 }, () => Array.from({ length: 160 }, () => every[Math.floor(rnd() * every.length)]).join(' ')),
        ...vocab.slice(0, 12).map((w) => Array(80).fill(w).join(' ')),
      ]
      for (const e of entries) {
        const r = entryRegex(e)
        // A warm pass first: V8 compiles a regex to native code after its first runs (measured: one ~55 ms spike, then
        // under 1 ms at 320 words) — that is not backtracking, which is slow on EVERY pass.
        for (const t of inputs) r.test(t)
        for (const t of inputs) {
          const t0 = performance.now()
          r.test(t)
          const ms = performance.now() - t0
          if (ms > 200) slow.push(`${ms.toFixed(0)} ms · ${e.pattern.slice(0, 60)} · ${t.slice(0, 60)}`)
        }
      }
    }
    expect(slow).toEqual([])
  }, 240_000)

  it('⚡ the WHOLE guard on a long sentence of every language\'s words — and joined with what was said — stays under 600 ms (measured locally: p95 2.4 ms on guide-like sentences)', () => {
    const texts = [...EN_CASES.offers, ...EN_CASES.ordinary, ...OTHER.flatMap((l) => [...LEXICON_CASES[l].offers, ...LEXICON_CASES[l].ordinary])]
    const every = [...new Set(texts.join(' ').split(/\s+/).filter(Boolean))]
    let seed = 11
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const worst: number[] = []
    for (let n = 0; n < 12; n++) {
      const t = Array.from({ length: 140 }, () => every[Math.floor(rnd() * every.length)]).join(' ')
      const t0 = performance.now()
      speakable(t, { teacherTurn: n % 2 === 0, lang: OTHER[n % OTHER.length] })
      worst.push(performance.now() - t0)
    }
    expect(Math.max(...worst)).toBeLessThan(600)
  }, 120_000)
})

describe('Traditional Chinese, 先生, and the lists\' boundaries (commit review round 2)', () => {
  it('⛔ a visa offer or ask in Traditional characters is one (簽證 is 签证)', () => {
    expect(speakable('我可以幫你辦簽證。', { teacherTurn: false, lang: 'zh' })).toBe(false)
    expect(speakable('我們可以幫您辦理落地簽。', { teacherTurn: false, lang: 'en' })).toBe(false)
    expect(i18nAsk('我想辦簽證')).toBe('visa')
    expect(norm('幫你辦簽證')).toBe('帮你办签证')
  })

  it('先生 is a teacher only in Japanese — in Chinese it is "Mr." (a landlord is no teacher turn); Traditional 老師 is one', () => {
    expect(isTeacherTalkI18n('房东王先生说周末可以看房')).toBe(false)
    expect(isTeacherTalkI18n('山田先生に英語を習いたいです')).toBe(true)
    expect(isTeacherTalkI18n('我想找一位英語老師')).toBe(true)
    expect(isTeacherTalkI18n('Je cherche un professeur d\'anglais')).toBe(true)
  })

  it('a boundary of `[^ ]` is exactly a Unicode letter boundary on norm()ed text — every entry, every verified sentence', () => {
    const unicode = (r: RegExp) => new RegExp(r.source.replaceAll('(?<![^ ])', '(?<![\\p{L}\\p{M}\\p{N}])').replaceAll('(?![^ ])', '(?![\\p{L}\\p{M}\\p{N}])'), 'u')
    const entries = Object.values(LEXICON).flatMap((L) => [...L.speechBan, ...L.counselWords, ...Object.values(L.asks).flat()]).filter((e) => e.boundary !== 'none')
    const texts = Object.values(LEXICON_CASES).flatMap((c) => [...c.ordinary, ...c.teacherOrdinary, ...c.mentions, ...c.offers, ...Object.values(c.asks).flat()]).map(norm)
    expect(entries.length).toBeGreaterThan(50)
    const differ: string[] = []
    for (const e of entries) {
      const fast = entryRegex(e)
      const slow = unicode(fast)
      for (const t of texts) if (fast.test(t) !== slow.test(t)) differ.push(`${e.pattern} · ${t}`)
    }
    expect(differ).toEqual([])
  }, 60_000)

  it('the warm-up only schedules: it never holds the server for the compile', () => {
    const t0 = performance.now()
    warmLanguageLists()
    warmLanguageLists()
    expect(performance.now() - t0).toBeLessThan(20)
  })
})

describe('commit review round 3', () => {
  it('⛔ an invisible character inside a banned word hides nothing (codex: "签\\u200B证", "vi\\u200Bsa")', () => {
    expect(speakable('我可以帮你办理签\u200b证。', { teacherTurn: false, lang: 'zh' })).toBe(false)
    expect(speakable('I can get you a vi\u200bsa for that.', { teacherTurn: false, lang: 'en' })).toBe(false)
    expect(speakable('Tôi có thể làm thị\u200b thực cho bạn.', { teacherTurn: false, lang: 'vi' })).toBe(false)
  })

  it('a Chinese work, class or viewing schedule is no itinerary, on any list (codex: Japanese 行程 dropped 工作行程)', () => {
    for (const lang of ['zh', 'ja', 'en'] as const) {
      expect(speakable('这是老师的工作行程。', { teacherTurn: false, lang })).toBe(true)
      expect(speakable('我把看房行程发给你了，周六上午看三套。', { teacherTurn: false, lang })).toBe(true)
      expect(speakable('我来帮你规划越南行程。', { teacherTurn: false, lang })).toBe(false)
    }
  })

  it('⛔ kana honorifics and particles, and Korean syllables, are no digits in a turn\'s count (opus) — a number read aloud still is', () => {
    expect(spokenDigits('オーナーさんにご連絡ください。')).toBe(0)
    expect(spokenDigits('1区に月1000万ドン以下の1LDKが3件あります。オーナーさんにご連絡ください。')).toBe(spokenDigits('1区に月1000万ドン以下の1LDKが3件あります。'))
    expect(spokenDigits('이삼 일 정도 걸려요. 강남구 이사 가능해요.')).toBe(0)
    expect(spokenDigits('ゼロきゅうゼロいちにさんよん')).toBe(7)
    expect(spokenDigits('ศูนย์เก้าศูนย์หนึ่ง')).toBe(4)
  })
})

describe('commit review round 4', () => {
  it('⛔ a trust claim is never said, in any language — a verification or safety word ON a seller, landlord, teacher or listing, or eno as the checker', () => {
    for (const [s, lang] of [
      ['Here are day tours in Mui Ne from verified sellers.', 'en'], ['These landlords are all verified.', 'en'], ['eno has verified every landlord here.', 'en'],
      ['Người bán này đã được xác minh, rất uy tín.', 'vi'], ['eno đã xác minh tất cả chủ nhà.', 'vi'],
      ['这个卖家已经核实，绝对安全。', 'zh'], ['這個賣家已經核實。', 'zh'], ['こちらは認証済みの出品者です。', 'ja'], ['인증된 판매자만 있어요.', 'ko'],
      ['Вот однодневные экскурсии в Муйне от проверенных продавцов.', 'ru'], ['Penjual ini disahkan dan boleh dipercayai.', 'ms'],
      ['ผู้ขายรายนี้ยืนยันแล้วค่ะ', 'th'], ['Ces vendeurs sont vérifiés.', 'fr'], ['ये सत्यापित विक्रेता हैं।', 'hi'],
    ] as const) expect(speakable(s, { teacherTurn: false, lang }), s).toBe(false)
  })

  it('…never a qualification, eno\'s own features named as they are, or the person\'s own checking', () => {
    for (const s of ['This teacher has a TEFL certificate.', 'This seller has a Trusted score.', 'Check the item before you pay.', 'Giáo viên này có chứng chỉ TEFL.',
      'Người bán có điểm uy tín 92.', 'Căn hộ chính chủ ở Quận 7.', '这位老师有TEFL证书。', 'Проверьте товар до оплаты.', 'Ce professeur est certifié TEFL.', 'यह शिक्षक प्रमाणित है।'])
      expect(speakable(s, { teacherTurn: false, lang: 'en' }), s).toBe(true)
  })

  it('a MENTION reaches the model through the WHOLE ask path too — no language\'s verified mention gets a fixed line (codex: "lịch trình xem nhà")', () => {
    for (const lang of OTHER) for (const s of LEXICON_CASES[lang].mentions) expect(fixedLineFor(s, lang), `${lang}: ${s}`).toBeNull()
    // …while a Vietnamese ASK still does
    for (const s of ['Làm visa cho mình được không?', 'Gia hạn visa ở đâu?', 'Lên kế hoạch du lịch Đà Lạt giúp mình', 'Lịch trình đi Sapa 3 ngày', 'Cho mình lịch trình du lịch Hội An'])
      expect(fixedLineFor(s, 'vi'), s).not.toBeNull()
  })

  it('a Korean number group (four or more digit syllables) counts in a turn — "이삼 일" still does not', () => {
    expect(spokenDigits('일이삼사. 오육칠팔.')).toBe(8)
    expect(spokenDigits('공일공. 일이삼. 사오육칠.')).toBe(10)
    expect(spokenDigits('이삼 일 정도 걸려요.')).toBe(0)
  })

  it('⛔ final review: a Vietnamese booking offer with the subject dropped or a question word before it is never said', () => {
    for (const s of ['Anh ơi, đặt tour Hạ Long cho anh luôn nhé?', 'Bạn cần không, mình đặt tour giúp bạn luôn.', 'Đặt giúp chị tour Sapa luôn nhé?'])
      expect(speakable(s, { teacherTurn: false, lang: 'vi' }), s).toBe(false)
    for (const s of ['Bạn có thể đặt tour với người bán trong chat nhé.', 'Người bán sẽ đặt tour cho bạn sau khi bạn nhắn tin.', 'Đây là các tour Hạ Long người bán đăng, bạn xem nhé.'])
      expect(speakable(s, { teacherTurn: false, lang: 'vi' }), s).toBe(true)
  })

  it('final round: a seller "is safe" (是…的) is a claim; French "ce point me…" and "un point info" are no addresses', () => {
    for (const s of ['这个卖家是安全的。', '这些房源都是安全的。', 'Écrivez à zalo point me.']) expect(speakable(s, { teacherTurn: false, lang: 'fr' }), s).toBe(false)
    for (const s of ['Ce point me semble important.', 'Il y a un point info à la gare.']) expect(speakable(s, { teacherTurn: false, lang: 'fr' }), s).toBe(true)
  })

  it('round 6: booking a tour "from local sellers" is still an offer; hyphenated spelled digits are a number', () => {
    expect(speakable('I can book a tour from local sellers.', { teacherTurn: false, lang: 'en' })).toBe(false)
    expect(speakable("We'll arrange your day trip with a local driver.", { teacherTurn: false, lang: 'en' })).toBe(false)
    expect(speakable('Here are day tours from local sellers.', { teacherTurn: false, lang: 'en' })).toBe(true)
    expect(speakable('Appelez le zéro-neuf-zéro-un-deux-trois-quatre-cinq-six-sept.', { teacherTurn: false, lang: 'fr' })).toBe(false)
    expect(spokenDigits('zéro-neuf-zéro-un')).toBe(4)
  })

  it('round 5: a reliability claim with no "already" (这个卖家很可靠), and "visa" in a language the guide does not speak', () => {
    for (const s of ['这个卖家很可靠。', '這些房東都很靠譜。', 'នេះជាទិដ្ឋាការទេសចរណ៍។', 'Te consigo el visado en dos días.', 'Ich besorge Ihnen das Visum.'])
      expect(speakable(s, { teacherTurn: false, lang: 'en' }), s).toBe(false)
    for (const s of ['这套公寓很安静。', 'Visto que buscas un piso, aquí tienes varios.'])
      expect(speakable(s, { teacherTurn: false, lang: 'en' }), s).toBe(true)
  })
})

describe('numbers and addresses read aloud', () => {
  it('⛔ another language\'s spelled number is one on any turn (commit review, codex: a guide drifts into French on an English turn)', () => {
    expect(speakable('Appelez le zéro neuf zéro un deux trois quatre cinq six sept.', { teacherTurn: false, lang: 'en' })).toBe(false)
    expect(speakable('Hubungi kosong sembilan kosong satu dua tiga empat lima enam tujuh.', { teacherTurn: false, lang: 'vi' })).toBe(false)
  })

  it('a turn\'s digit count: digit words and Han numerals three or more in a row; one or two are words', () => {
    expect(digitizeRuns('gọi không chín không một')).toBe('gọi 0 9 0 1')
    expect(spokenDigits('Bạn muốn xem căn này không? Năm nay giá tốt.')).toBe(0)
    expect(spokenDigits('第一郡有三套一千万越南盾以下的一居室。')).toBe(0)
    expect(spokenDigits('电话零九零一二三四')).toBe(7)
    expect(spokenDigits('โทรศูนย์เก้าศูนย์ค่ะ ห้องนี้อยู่ได้สามสี่คน')).toBe(3)
  })

  it('a script\'s own numerals and spelled digits become digits — runs only (an everyday word stays a word around them)', () => {
    expect(digitize('गोल्ड ०९०१२३४५६७ पर कॉल करें')).toContain('0901234567')
    expect(digitize('โทร ๐๙๐๑๒๓๔๕๖๗')).toContain('0901234567')
    expect(digitize('电话零九零一二三四五六七')).toContain('0901234567')
    expect(digitize('gọi không chín không một hai ba bốn năm sáu bảy')).toContain('0 9 0 1 2 3 4 5 6 7')
    expect(digitize('năm nay')).toBe('5 nay') // one digit word alone: no run — guards.ts counts runs of 8
  })

  it('a number spelled in an unspaced script\'s digit words (Thai, kana, Korean) is one — a run of eight or more; everyday words are not', () => {
    expect(speakable('โทร ศูนย์เก้าศูนย์หนึ่งสองสามสี่ห้าหกเจ็ด นะคะ', { teacherTurn: false, lang: 'th' })).toBe(false)
    expect(speakable('ゼロきゅうゼロいちにさんよんごろくななに電話してください。', { teacherTurn: false, lang: 'ja' })).toBe(false)
    expect(speakable('공일공 일이삼사 오육칠팔로 전화하세요.', { teacherTurn: false, lang: 'ko' })).toBe(false)
    expect(speakable('ห้องนี้อยู่ได้สามสี่คนค่ะ', { teacherTurn: false, lang: 'th' })).toBe(true)
    expect(speakable('이 집은 이 층에 있어요.', { teacherTurn: false, lang: 'ko' })).toBe(true)
  })

  it('a web address or an email said with the language\'s own words is never spoken; English "at"/"dot" stay guards.ts\'s', () => {
    expect(i18nUnspeakable('Écrivez à vendeur arobase gmail point com', { lang: 'fr', teacherTurn: false })).toBe(true)
    expect(i18nUnspeakable('Xem trang nhatot chấm com nhé', { lang: 'vi', teacherTurn: false })).toBe(true)
    expect(i18nUnspeakable('Look at this one in District 1.', { lang: 'en', teacherTurn: false })).toBe(false)
  })

  it('norm keeps a Hindi or Thai vowel sign (it is a letter there) and joins Thai words split by speech-to-text', () => {
    expect(norm('वीज़ा')).toBe('वीज़ा'.normalize('NFC'))
    expect(norm('วี ซ่า')).toBe('วีซ่า')
  })
})
