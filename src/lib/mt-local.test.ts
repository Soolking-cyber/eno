import { describe, expect, it } from 'vitest'
import { gateTranslation } from './mt-gate'

/**
 * ⛔ EVERY REJECT CASE BELOW IS A REAL OUTPUT MEASURED ON THE BOX, not an invented one.
 * NLLB-600M produced these from real listing titles during the 2026-09-09 benchmark — the
 * model this server was first built on, before its CC-BY-NC licence ruled it out. The shipped
 * model (m2m100_418M, MIT) gets these particular titles right, but the cases are kept: each
 * reads as fluent English while describing the wrong product, nothing downstream could catch
 * them, and the cache that would hold them has no expiry.
 */
describe('gateTranslation — rejects', () => {
  it('rejects a hallucination that dropped the model code', () => {
    expect(gateTranslation(
      'Máy lạnh Daikin 1.0HP 2025 (FTKB25ZVMV/RKB25ZVMV)',
      'The cooling system is designed to be used in the manufacture of refrigeration equipment',
    )).toBe('entity-loss')
  })

  it('rejects the ViewSonic case that started this', () => {
    expect(gateTranslation(
      'Màn hình Gaming ViewSonic VX2779-HD-PRO 27 inch',
      'The game is available on the PlayStation VX2779 HD-PRO 27 inch gaming view.',
    )).toBe('entity-loss')
  })

  it('rejects boilerplate even when every entity survived', () => {
    // The boilerplate check is NOT redundant with entity-loss: a title carrying no model code
    // at all can still be replaced wholesale by invented text, and then entity-loss sees nothing.
    expect(gateTranslation(
      'Ghế văn phòng lưng lưới xoay êm ái thoáng khí',
      'This is designed to be used in offices and homes',
    )).toBe('boilerplate')
  })

  it('rejects a collapsed translation', () => {
    expect(gateTranslation(
      'Bộ bàn ăn 6 ghế gỗ sồi tự nhiên cao cấp nhập khẩu nguyên chiếc từ Malaysia',
      'Table.',
    )).toBe('length-ratio')
  })

  it('rejects decoder loops', () => {
    expect(gateTranslation(
      'Áo thun nam cotton form rộng nhiều màu size lớn',
      'shirt shirt shirt shirt shirt shirt shirt shirt shirt for men',
    )).toBe('repetition')
  })

  it('rejects empty and whitespace output', () => {
    expect(gateTranslation('Máy lạnh Daikin', '')).toBe('empty')
    expect(gateTranslation('Máy lạnh Daikin', '   ')).toBe('empty')
  })
})

describe('gateTranslation — accepts', () => {
  it('accepts a good translation that carries its entities', () => {
    expect(gateTranslation(
      'Sim 4G Viettel 12MXH100 1GB/Ngày - 12 tháng',
      'Viettel 4G SIM 12MXH100 1GB/day - 12 months',
    )).toBeNull()
  })

  /**
   * ⚠️ THE REASON THE DIGIT THRESHOLD IS 3 AND NOT 2. Two-digit numbers are screen sizes and
   * quantities that legitimately requantify across languages; gating on them flagged ordinary
   * good translations and would have sent them to the paid provider for nothing.
   */
  it('does not flag a two-digit number that moved', () => {
    expect(gateTranslation('Màn hình 27 inch', 'The 27-inch monitor')).toBeNull()
  })

  it('accepts legitimate expansion — vi->en really is longer', () => {
    expect(gateTranslation('Bàn gỗ', 'A wooden table')).toBeNull()
  })

  it('accepts repeated words in a genuinely short string', () => {
    // Under 9 words the repetition ratio is noise, so it must not fire.
    expect(gateTranslation('Áo thun', 'shirt shirt')).toBeNull()
  })
})

/**
 * ⛔ THE FLAT 0.45 FLOOR REJECTED HALF OF ALL CHINESE OUTPUT. Measured on the box over 60 real
 * listing strings, the share of GOOD translations falling under a flat 0.45 floor:
 *   zh-Hans 50% · ko 27% · ja 20% · ru 2% · th 0% · en 0%
 * Four of the five EAGER_WARM_LANGS are CJK-adjacent, so a shared floor would have paid Google
 * for exactly the traffic this module exists to stop paying for.
 */
describe('gateTranslation — the length floor is per target language', () => {
  // 74 Latin characters rendered as ~20 Han characters: ratio 0.27, a faithful translation.
  const src = 'Bộ bàn ăn 6 ghế gỗ sồi tự nhiên cao cấp nhập khẩu nguyên chiếc từ Malaysia'
  const zh = '马来西亚进口天然橡木六椅餐桌套装'

  it('accepts dense Chinese that a shared floor would have called collapsed', () => {
    expect(gateTranslation(src, zh, 'zh-Hans')).toBeNull()
  })

  it('accepts the same density for ja and ko', () => {
    expect(gateTranslation(src, 'マレーシア産天然オーク材の六脚ダイニングセット', 'ja')).toBeNull()
    expect(gateTranslation(src, '말레이시아산 천연 오크 6인 식탁 세트', 'ko')).toBeNull()
  })

  it('still rejects that ratio for a Latin-script target, where it IS a collapse', () => {
    expect(gateTranslation(src, 'A dining set.', 'en')).toBe('length-ratio')
  })

  it('falls back to the strict floor when no target is given', () => {
    expect(gateTranslation(src, zh)).toBe('length-ratio')
  })

  it('keeps the runaway ceiling shared across every script', () => {
    expect(gateTranslation('Bàn', 'a very long invented description of a table that goes on', 'zh-Hans'))
      .toBe('length-ratio')
  })
})

describe('gateTranslation — entity matching is case-insensitive', () => {
  /**
   * ⚠️ INSURANCE, NOT A FIX. Measured on the real corpus the case-sensitive and
   * case-insensitive checks flagged the same 2/60 strings, so this changed nothing in
   * practice — but rejecting a preserved model code purely because the translator title-cased
   * it would send a good translation to the paid provider for nothing.
   */
  it('accepts a model code the translator changed case on', () => {
    expect(gateTranslation('Máy lạnh FTKB25ZVMV chính hãng', 'Genuine ftkb25zvmv air conditioner')).toBeNull()
  })

  it('still rejects a model code that is genuinely gone', () => {
    expect(gateTranslation('Máy lạnh FTKB25ZVMV chính hãng', 'Genuine air conditioner unit')).toBe('entity-loss')
  })
})

/**
 * ⛔ THE CEILING HAD THE MIRROR OF THE FLOOR BUG. A target-only table fixes vi→zh compression
 * and still rejects every zh→en translation, because a faithful rendering of Han source
 * EXPANDS 3-5x. The band has to come from the PAIR (agy, reviewing this diff).
 */
describe('gateTranslation — the band is computed from source AND target', () => {
  const zh = '马来西亚进口天然橡木六椅餐桌套装'
  const en = 'A six-chair dining table set in natural oak, imported from Malaysia'

  it('accepts the 4x expansion of a faithful zh->en translation', () => {
    expect(gateTranslation(zh, en, 'en', 'zh-Hans')).toBeNull()
  })

  it('accepts the reciprocal compression en->zh', () => {
    expect(gateTranslation(en, zh, 'zh-Hans', 'en')).toBeNull()
  })

  it('still catches a genuine collapse on the same pair', () => {
    expect(gateTranslation(zh, 'A table.', 'en', 'zh-Hans')).toBe('length-ratio')
  })

  it('still catches runaway expansion on the same pair', () => {
    expect(gateTranslation(zh, en.repeat(6), 'en', 'zh-Hans')).toBe('length-ratio')
  })
})

describe('gateTranslation — an entity must survive as a WHOLE token', () => {
  /**
   * ⛔ A bare `includes` accepted "VX27790" as proof that "VX2779" survived — a different
   * product, silently cached forever (astra, reviewing this diff).
   */
  it('rejects a model code that was altered rather than preserved', () => {
    expect(gateTranslation('Màn hình ViewSonic VX2779 27 inch', 'ViewSonic VX27790 27 inch monitor'))
      .toBe('entity-loss')
  })

  it('accepts the code when it survives surrounded by punctuation', () => {
    expect(gateTranslation('Màn hình ViewSonic VX2779 27 inch', 'ViewSonic monitor (VX2779), 27 inch'))
      .toBeNull()
  })
})

/**
 * ⛔ WHAT COUNTS AS A MODEL CODE. The first version of ENTITY was `[A-Z0-9]{2,}`, which was
 * wrong in three ways at once — every case below is one of them, reproduced before the fix.
 */
describe('gateTranslation — only real model codes are mandatory', () => {
  it('does not treat ordinary capitalised words as codes', () => {
    // "BLACK"/"TABLE" were mandatory tokens, so the correct translation was REJECTED and sent
    // to the paid provider — the gate spending money to punish correct work.
    expect(gateTranslation('Bàn Gỗ BLACK TABLE cao cấp', 'A high-end black wooden table')).toBeNull()
  })

  it('does not treat an ALL-CAPS Vietnamese word as a code', () => {
    expect(gateTranslation('Áo THUN NAM size L', "Men's t-shirt size L")).toBeNull()
  })

  it('captures a hyphenated code WHOLE, so a substituted tail is caught', () => {
    // The old pattern captured only "VX2779-HD", which "VX2779-HD-FAKE" satisfied.
    expect(gateTranslation('Màn hình ViewSonic VX2779-HD-PRO', 'ViewSonic VX2779-HD-PRO monitor')).toBeNull()
    expect(gateTranslation('Màn hình ViewSonic VX2779-HD-PRO', 'ViewSonic VX2779-HD-FAKE monitor')).toBe('entity-loss')
  })

  it('catches a dropped LOWERCASE code, which the uppercase-only pattern missed entirely', () => {
    expect(gateTranslation('Máy lạnh ftkb25zvmv chính hãng', 'Genuine air conditioner unit')).toBe('entity-loss')
  })

  it('treats / as a separator, not a code joiner', () => {
    // "1GB/Ngày" is "1GB per day": joining on / demanded the English output contain "Ngày".
    expect(gateTranslation('Sim 4G Viettel 12MXH100 1GB/Ngày', 'Viettel 4G SIM 12MXH100 1GB/day')).toBeNull()
  })

  it('still requires a capacity figure to survive', () => {
    expect(gateTranslation('Tủ lạnh 520L Hitachi', 'Hitachi 520L refrigerator')).toBeNull()
    expect(gateTranslation('Tủ lạnh 520L Hitachi', 'Hitachi refrigerator')).toBe('entity-loss')
  })
})


/**
 * ⛔ THE HYPHEN IS BOTH A CODE JOINER AND A WORD BOUNDARY, AND IT CANNOT BE BOTH HERE.
 * With a boundary of `[^A-Za-z0-9]`, "VX2779-HD-PRO-FAKE" satisfied "VX2779-HD-PRO" — a
 * different model passing the one check that exists to catch exactly that substitution.
 */
describe('gateTranslation — a code must not be extended by a suffix', () => {
  const src = 'Màn hình ViewSonic VX2779-HD-PRO 27 inch'

  it('rejects a code that grew a suffix', () => {
    expect(gateTranslation(src, 'ViewSonic VX2779-HD-PRO-FAKE monitor 27 inch')).toBe('entity-loss')
  })

  it('accepts the code followed by ordinary punctuation', () => {
    expect(gateTranslation(src, 'ViewSonic VX2779-HD-PRO, 27 inch monitor')).toBeNull()
  })

  it('rejects a digit-extended code', () => {
    expect(gateTranslation('Màn hình VX2779 27 inch', 'The VX27790 monitor, 27 inch')).toBe('entity-loss')
  })
})

/**
 * ⛔ A DECIMAL SPEC IS ONE ENTITY. Before the leading alternative in ENTITY, `\b` fired between
 * the "." and the "0" of "1.0HP", so the mandatory token was "0HP" — which "2.0HP" also
 * contains. The gate accepted a translation that DOUBLED the advertised capacity.
 */
describe('gateTranslation — decimal specifications', () => {
  it('rejects a translation that changed the decimal capacity', () => {
    expect(gateTranslation('Máy lạnh Daikin 1.0HP', 'Daikin 2.0HP air conditioner')).toBe('entity-loss')
  })

  it('accepts the same capacity carried through', () => {
    expect(gateTranslation('Máy lạnh Daikin 1.0HP', 'Daikin 1.0HP air conditioner')).toBeNull()
  })

  it('handles a decimal clock speed', () => {
    expect(gateTranslation('CPU 2.4GHz Intel', 'Intel 2.4GHz processor')).toBeNull()
    expect(gateTranslation('CPU 2.4GHz Intel', 'Intel 3.4GHz processor')).toBe('entity-loss')
  })

  it('does not make a bare decimal measurement mandatory', () => {
    // "27.5 inch" has no unit glued to it, so it is prose, not a part number.
    expect(gateTranslation('Màn hình 27.5 inch', 'A 27.5 inch monitor')).toBeNull()
  })
})

/**
 * ⛔ THE WRONG SCREEN SIZE IS A WRONG PRODUCT. Two-digit numbers were ungated for a while
 * because "27 inch" → "27-inch" tripped a hyphen-excluding boundary — the boundary's fault, not
 * the threshold's. With a non-digit boundary for pure numbers, both hold at once.
 */
describe('gateTranslation — two-digit specifications', () => {
  it('rejects a changed screen size', () => {
    expect(gateTranslation('Màn hình 27 inch Full HD', 'A 32-inch Full HD monitor')).toBe('entity-loss')
  })

  it('accepts the size compounded with a hyphen, which is why this was hard', () => {
    expect(gateTranslation('Màn hình 27 inch Full HD', 'A 27-inch Full HD monitor')).toBeNull()
  })

  it('accepts the size left as a separate word', () => {
    expect(gateTranslation('Màn hình 27 inch Full HD', 'A 27 inch Full HD monitor')).toBeNull()
  })

  it('does not accept a longer number that merely contains it', () => {
    expect(gateTranslation('Màn hình 27 inch Full HD', 'A 270 inch Full HD monitor')).toBe('entity-loss')
  })
})

/**
 * ⛔ THE STAKES ROSE WHEN scripts/backfill-bilingual.ts STARTED USING THIS GATE. That script does
 * not fill an evictable cache — it MOVES COLUMNS, writing into `title`/`description`, which
 * useLocalized() prefers over every other source. Each case below is a way a wrong value used to
 * reach those columns permanently.
 */
describe('gateTranslation — numbers that must not drift', () => {
  it('rejects a size that gained a decimal', () => {
    expect(gateTranslation('Màn hình 27 inch', 'A 27.5-inch monitor')).toBe('entity-loss')
  })

  it('accepts a decimal size carried through, hyphen-compounded', () => {
    expect(gateTranslation('Màn hình 27.5 inch', 'A 27.5-inch monitor')).toBeNull()
  })

  /** ⛔ Grouped thousands used to reduce to "500" and "000", so 1.5M → 2.5M passed. A PRICE. */
  it('rejects a changed grouped price', () => {
    expect(gateTranslation('Giá 1.500.000 đồng', 'Price 2.500.000 dong')).toBe('entity-loss')
    expect(gateTranslation('Giá 1.500.000 đồng', 'Price 1.500.000 dong')).toBeNull()
  })

  it('accepts a unit that gained a space, which MT does routinely', () => {
    expect(gateTranslation('Máy lạnh 1.0HP', 'A 1.0 HP air conditioner')).toBeNull()
    expect(gateTranslation('Ổ cứng 500GB', 'A 500 GB hard drive')).toBeNull()
  })

  it('still rejects the substitution behind that leniency', () => {
    expect(gateTranslation('Máy lạnh 1.0HP', 'A 2.0 HP air conditioner')).toBe('entity-loss')
  })
})

/**
 * ⛔ AN ECHO IS THE ONE FAILURE THE BACKFILL EXISTS TO REMOVE. It moves Vietnamese OUT of the
 * English column; a model returning the input unchanged, accepted, writes Vietnamese into the
 * English slot and marks the row done — recreating the defect and putting the row beyond the
 * reach of its own selection predicate. Ratio 1, every entity trivially intact, no boilerplate.
 */
describe('gateTranslation — an echo is not a translation', () => {
  it('rejects output identical to the input', () => {
    expect(gateTranslation('Áo thun nam', 'Áo thun nam')).toBe('untranslated')
    expect(gateTranslation('Sách Trúng Số Tái Bản', 'Sách Trúng Số Tái Bản')).toBe('untranslated')
  })

  it('rejects an echo that differs only in case and punctuation', () => {
    expect(gateTranslation('Sách Trúng Số Tái Bản', 'sách trúng số, tái bản!')).toBe('untranslated')
  })

  it('accepts a real translation of the same row', () => {
    expect(gateTranslation('Sách Trúng Số Tái Bản', 'Lottery Winning Book, Reprint')).toBeNull()
  })
})

/**
 * ⛔ NUMBERS ARE COMPARED BY VALUE, NOT BY STRING BOUNDARY. A regex-boundary version was wrong in
 * BOTH directions at once — it rejected ordinary punctuation and correct locale conversion while
 * accepting a thousandfold capacity change. Each case below pins one half of that.
 */
describe('gateTranslation — quantities survive formatting, not substitution', () => {
  it('accepts a trailing full stop after a protected number', () => {
    expect(gateTranslation('Số lượng 12', 'Quantity: 12.')).toBeNull()
  })

  it('accepts a Vietnamese thousands separator converted to English', () => {
    // 1.500.000 and 1,500,000 are the same number — refusing this refused a CORRECT translation.
    expect(gateTranslation('Giá 1.500.000 đồng', 'Price 1,500,000 dong')).toBeNull()
  })

  it('rejects a capacity that gained a leading decimal', () => {
    // ⚠️ THE LANGUAGES MATTER AND THE REAL CALLER ALWAYS PASSES THEM. Read as Vietnamese on both
    // sides — the default — "0.500" IS 500, correctly, because `.` groups thousands there. The
    // error only exists across the vi→en boundary, which is the direction this backfill runs.
    expect(gateTranslation('Ổ cứng 500GB', 'A 0.500GB hard drive', 'en', 'vi')).toBe('entity-loss')
  })

  it('rejects a code whose letters changed across the hyphen', () => {
    // "AB-1234" was never captured whole, so only "1234" was protected and "CD-1234" passed.
    expect(gateTranslation('Mẫu AB-1234', 'Model CD-1234')).toBe('entity-loss')
  })
})

describe('gateTranslation — an echo is only a failure when it had to change', () => {
  it('accepts a brand-and-model title that is identical in both languages', () => {
    // Flagging these left every such row unenriched and re-selected on every run.
    expect(gateTranslation('iPhone 15 Pro', 'iPhone 15 Pro')).toBeNull()
  })

  it('accepts a single diacriticked name', () => {
    expect(gateTranslation('Phở', 'Phở')).toBeNull()
  })

  it('still rejects an echoed Vietnamese phrase', () => {
    expect(gateTranslation('Áo thun nam', 'Áo thun nam')).toBe('untranslated')
  })

  it('never flags an echo when Vietnamese is the TARGET', () => {
    expect(gateTranslation('Áo thun nam', 'Áo thun nam', 'vi')).toBeNull()
  })
})

/**
 * ⛔ SEPARATOR CONVENTIONS ARE INVERTED BETWEEN THE TWO LANGUAGES THIS MOSTLY TRANSLATES, so a
 * language-blind number parser is wrong in the expensive direction: English "1.250" is one and a
 * quarter, Vietnamese "1.250" is one thousand two hundred and fifty.
 */
describe('gateTranslation — numbers are parsed in their own language', () => {
  it('rejects an English decimal read as thousands', () => {
    expect(gateTranslation('Weight 1.250 kg', 'Khối lượng 1250 kg', 'vi', 'en')).toBe('entity-loss')
  })

  it('accepts an English grouping converted to the Vietnamese one', () => {
    expect(gateTranslation('Weight 1,250 kg', 'Khối lượng 1.250 kg', 'vi', 'en')).toBeNull()
  })

  it('does not mistake a Vietnamese-parsed decimal for a grouping', () => {
    // "1.0" cannot be a grouping (a group is exactly three digits), so it is a decimal — reading
    // it as "10" made a faithful translation compare unequal.
    expect(gateTranslation('Máy lạnh 1.0HP, công suất 2.0kW', 'Air conditioner 1.0HP, power 2.0kW')).toBeNull()
  })

  /** ⛔ Bare-number comparison let capacity and power simply trade places. */
  it('rejects two specifications swapping their units', () => {
    expect(gateTranslation('Máy lạnh 1.0HP, công suất 2.0kW', 'Air conditioner 2.0HP, power 1.0kW'))
      .toBe('entity-loss')
  })

  it('still allows a unit that genuinely translates', () => {
    expect(gateTranslation('Bảo hành 12 tháng', 'Warranty 12 months')).toBeNull()
  })

  /** ⚠️ A set would let one surviving 12 satisfy both occurrences. */
  it('counts repeated quantities', () => {
    expect(gateTranslation('Kích thước 12 x 12 cm', 'Size 12 cm')).toBe('entity-loss')
    expect(gateTranslation('Kích thước 12 x 12 cm', 'Size 12 x 12 cm')).toBeNull()
  })

  it('protects a slash-joined model code', () => {
    expect(gateTranslation('Mẫu AB/1234', 'Model CD/1234')).toBe('entity-loss')
  })
})

describe('gateTranslation — echo detection is directional', () => {
  it('catches an echoed English phrase on the EN->VI leg', () => {
    expect(gateTranslation(
      'Brand new sealed laptop with free nationwide delivery',
      'Brand new sealed laptop with free nationwide delivery', 'vi', 'en',
    )).toBe('untranslated')
  })

  /**
   * ⚠️ A DOCUMENTED GAP, NOT AN OVERSIGHT. Going INTO Vietnamese there is no proof the text had
   * to change: a short undiacriticked string that comes back unchanged may be untranslated
   * English or a brand identical in every language. Rejecting those would strand every
   * brand-titled row forever, so short EN->VI echoes are accepted.
   */
  it('accepts a short EN->VI echo, which is indistinguishable from a brand', () => {
    expect(gateTranslation('Black table', 'Black table', 'vi', 'en')).toBeNull()
    expect(gateTranslation('iPhone 15 Pro', 'iPhone 15 Pro', 'vi', 'en')).toBeNull()
  })
})

/**
 * ⛔ EACH SIDE IS READ IN ITS OWN SEPARATOR CONVENTION, PLUS THE RAW LITERAL — and nothing more.
 * Recording the other convention's reading too made both sides so permissive that real errors
 * matched (English "0.500GB" reads as 500 under Vietnamese grouping). A correct re-localisation
 * matches on the VALUE, a verbatim echo matches on the RAW, a substitution matches on neither.
 */
describe('gateTranslation — a quantity may be re-localised or echoed, never changed', () => {
  it('accepts a price echoed verbatim, formatting and all', () => {
    // The model very often keeps the source formatting. The digits are unchanged: a cosmetic
    // nit, not a wrong price, and rejecting it would strand a large share of the catalogue.
    expect(gateTranslation('Giá 1.500.000 đồng', 'Price 1.500.000 dong')).toBeNull()
  })

  it('accepts a price correctly re-localised', () => {
    expect(gateTranslation('Giá 1.500.000 đồng', 'Price 1,500,000 dong')).toBeNull()
  })

  it('rejects a price whose digits changed', () => {
    expect(gateTranslation('Giá 1.500.000 đồng', 'Price 2.500.000 dong')).toBe('entity-loss')
  })

  it('rejects a thousandfold capacity change that looks like formatting', () => {
    expect(gateTranslation('Ổ cứng 500GB', 'A 0.500GB hard drive', 'en', 'vi')).toBe('entity-loss')
  })

  it('reads an English decimal as a decimal, not as thousands', () => {
    expect(gateTranslation('Weight 1.250 kg', 'Khối lượng 1250 kg', 'vi', 'en')).toBe('entity-loss')
    expect(gateTranslation('Weight 1,250 kg', 'Khối lượng 1.250 kg', 'vi', 'en')).toBeNull()
  })

  it('rejects two specifications trading their units', () => {
    expect(gateTranslation('Máy lạnh 1.0HP, công suất 2.0kW', 'Air conditioner 2.0HP, power 1.0kW'))
      .toBe('entity-loss')
  })

  it('accepts a decimal rendered without its trailing zero', () => {
    expect(gateTranslation('Máy lạnh 1.0 HP', 'Air conditioner 1 HP')).toBeNull()
  })

  it('rejects a code that gained a suffix even when it has no hyphen of its own', () => {
    expect(gateTranslation('Mẫu VX2779', 'Model VX2779-FAKE')).toBe('entity-loss')
  })
})

/**
 * ⛔ THE LAST ROUND OF REVIEW FINDINGS, each reproduced before it was fixed. All four are ways a
 * wrong value reached — or a right value was blocked from reaching — an authoritative column.
 */
describe('gateTranslation — units, separators and normalisation forms', () => {
  it('accepts a decimal spec normalised without its trailing zero', () => {
    // "1.0HP" had its tail "0HP" mis-extracted as a model code, so the faithful "1 HP" — which
    // the quantity check already equated — was rejected as entity loss.
    expect(gateTranslation('Máy lạnh 1.0HP', 'Air conditioner 1 HP', 'en', 'vi')).toBeNull()
    expect(gateTranslation('Máy lạnh 1.0HP', 'Air conditioner 2 HP', 'en', 'vi')).toBe('entity-loss')
  })

  it('rejects a code extended by EITHER joiner', () => {
    // A dynamic exclusion let each separator terminate a code that did not contain it.
    expect(gateTranslation('Mẫu VX2779', 'Model VX2779-FAKE', 'en', 'vi')).toBe('entity-loss')
    expect(gateTranslation('Mẫu VX2779', 'Model VX2779_FAKE', 'en', 'vi')).toBe('entity-loss')
  })

  /** ⛔ kg → g is a thousandfold change that passed because `g` was not a recognised unit. */
  it('rejects a mass unit swapped for its thousandth', () => {
    expect(gateTranslation('Khối lượng 500 kg', 'Weight 500 g', 'en', 'vi')).toBe('entity-loss')
    expect(gateTranslation('Khối lượng 500 kg', 'Weight 500 kg', 'en', 'vi')).toBeNull()
  })

  it('does not mistake the first letter of a word for a unit', () => {
    // Recognising single-letter units is only safe because the unit must be a WHOLE word:
    // "500 gói" (500 packs) must not pair 500 with grams.
    expect(gateTranslation('Gói 500 gói', 'Pack of 500 packs', 'en', 'vi')).toBeNull()
  })

  it('detects an echo in decomposed (NFD) Vietnamese', () => {
    // VI_MARK lists precomposed characters; Vietnamese arrives in both normalisation forms, and
    // an unmatched NFD source let untranslated Vietnamese into the English column.
    const nfd = 'Áo thun nam'.normalize('NFD')
    expect(gateTranslation(nfd, nfd, 'en', 'vi')).toBe('untranslated')
  })
})

describe('gateTranslation — the last review round', () => {
  it('rejects a weight whose unit changed to a non-metric one', () => {
    // `lb` was unrecognised, so it read as "no unit" and matched anything.
    expect(gateTranslation('Khối lượng 500 kg', 'Weight 500 lb', 'en', 'vi')).toBe('entity-loss')
  })

  it('rejects a code given a slash suffix, while leaving a slash separator alone', () => {
    // The boundary now mirrors codesIn: a slash ends a code UNLESS a digit follows it.
    expect(gateTranslation('Mẫu VX2779', 'Model VX2779/2', 'en', 'vi')).toBe('entity-loss')
    expect(gateTranslation('Sim 12MXH100 1GB/Ngày', 'SIM 12MXH100 1GB/day', 'en', 'vi')).toBeNull()
  })

  it('handles a value carrying BOTH a grouping and a decimal separator', () => {
    // "1.500,50" → "1,500.50" is a correct conversion; neither form parsed before.
    expect(gateTranslation('Giá 1.500,50 đồng', 'Price 1,500.50 dong', 'en', 'vi')).toBeNull()
    expect(gateTranslation('Giá 1.500,50 đồng', 'Price 2,500.50 dong', 'en', 'vi')).toBe('entity-loss')
  })
})
