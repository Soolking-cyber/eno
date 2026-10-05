import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attrMatcher } from './attr-match'
import {
  LEXICON_PHRASES,
  LEXICON_VALUES,
  MATERIAL_CATEGORY,
  attributesWithTitleMaterial,
  decideTitleMaterial,
  materialFromTitle,
  materialMentions,
  materialOptions,
  ownWordsTitle,
  readMaterial,
  titleMaterialFill,
} from './furniture-material'
import { FALLBACK_FACET, fallbackBandKey } from './price-fallback'
import { facetsFor } from './taxonomy'

const SHELVES = ['sofa-seating', 'tables-desks', 'beds-mattresses', 'storage'] as const
const m = (title: string, shelf: string = 'storage') => materialFromTitle(title, shelf)

describe('the lexicon answers only in the taxonomy’s own words', () => {
  it('every value it can return is a `material` option of the furniture shelves', () => {
    const offered = new Set(SHELVES.flatMap((s) => facetsFor(MATERIAL_CATEGORY, s).find((f) => f.key === 'material')!.options.map((o) => o.value)))
    expect(LEXICON_VALUES.length).toBeGreaterThan(0)
    for (const v of LEXICON_VALUES) expect(offered, v).toContain(v)
  })
  it('materialOptions is the taxonomy’s list on the four shelves, and empty anywhere else', () => {
    for (const s of SHELVES) expect([...materialOptions(s)]).toEqual(['wood', 'fabric', 'metal', 'glass', 'rattan-bamboo'])
    for (const s of ['white-goods', 'kitchenware', 'lighting-decor', '', null, undefined]) expect(materialOptions(s)).toEqual([])
  })
  it('no phrase sits under two readings, and every phrase is already in the shape a title is reduced to', () => {
    expect(new Set(LEXICON_PHRASES).size).toBe(LEXICON_PHRASES.length)
    for (const p of LEXICON_PHRASES) {
      expect(p, p).toBe(p.normalize('NFC').toLowerCase())
      expect(p, p).toMatch(/^[\p{L}\p{M}\p{N}]+( [\p{L}\p{M}\p{N}]+)*$/u)
    }
  })
  it('covers exactly the shelves the fallback band keys on material', () => {
    const keyed = Object.entries(FALLBACK_FACET).filter(([, f]) => f === 'material').map(([k]) => k.split('/')[1]).sort()
    expect(keyed).toEqual([...SHELVES].sort())
  })
})

describe('materialFromTitle — Vietnamese', () => {
  it.each([
    ['Giường Gỗ Cũ Màu Nâu 1m6', 'beds-mattresses', 'wood'],
    ['Tủ Quần Áo Gỗ Sồi 3 Cánh', 'storage', 'wood'],
    ['Bàn Làm Việc Gỗ MDF Cũ', 'tables-desks', 'wood'],
    ['Ghế Sofa Bọc Nỉ Màu Xám', 'sofa-seating', 'fabric'],
    ['Sofa Da Bò Cũ', 'sofa-seating', 'fabric'],
    ['Giường Bọc Nhung Màu Kem', 'beds-mattresses', 'fabric'],
    ['Ghế Bar Bọc Simili', 'sofa-seating', 'fabric'],
    ['Bàn Sắt Gấp Gọn', 'tables-desks', 'metal'],
    ['Tủ Locker Sắt 18 Ngăn', 'storage', 'metal'],
    ['Kệ Inox 3 Tầng', 'storage', 'metal'],
    ['Giường Tầng Khung Sắt Sơn Trắng', 'beds-mattresses', 'metal'],
    ['Tủ Kính Trưng Bày Cũ', 'storage', 'glass'],
    ['Bàn Sofa Mặt Kính Cũ', 'tables-desks', 'glass'],
    ['Giường Tre Cũ 1M2', 'beds-mattresses', 'rattan-bamboo'],
    ['Ghế Mây Đan Cũ', 'sofa-seating', 'rattan-bamboo'],
  ])('%s → %s', (title, shelf, want) => {
    expect(materialFromTitle(title, shelf)).toBe(want)
  })

  it('names the same material twice without conflict ("Vải Nỉ" is fabric twice)', () => {
    expect(m('Bộ Sofa Băng Cũ Chất Liệu Vải Nỉ', 'sofa-seating')).toBe('fabric')
    expect(m('Thanh Lý Giường 1M8x2M Bọc Da Simili', 'beds-mattresses')).toBe('fabric')
  })
})

describe('materialFromTitle — English', () => {
  it.each([
    ['Used Wooden Bed', 'beds-mattresses', 'wood'],
    ['Solid oak dining table', 'tables-desks', 'wood'],
    ['Rubber wood dining table', 'tables-desks', 'wood'],
    ['Fabric sofa, 3 seats', 'sofa-seating', 'fabric'],
    ['Leather recliner armchair', 'sofa-seating', 'fabric'],
    ['Faux leather bar stool', 'sofa-seating', 'fabric'],
    ['Metal desk', 'tables-desks', 'metal'],
    ['Stainless steel shelf, 3 tiers', 'storage', 'metal'],
    ['Glass coffee table', 'tables-desks', 'glass'],
    ['Rattan armchair', 'sofa-seating', 'rattan-bamboo'],
    ['Bed with a wooden frame', 'beds-mattresses', 'wood'],
    ['Coffee table with a glass top', 'tables-desks', 'glass'],
  ])('%s → %s', (title, shelf, want) => {
    expect(materialFromTitle(title, shelf)).toBe(want)
  })
  it('a LOOK is not a material: oak colour, wood grain, marble effect, chrome finish', () => {
    expect(m('Oak colour wardrobe')).toBeNull()
    expect(m('Wood-grain filing cabinet')).toBeNull()
    expect(m('Marble effect coffee table', 'tables-desks')).toBeNull()
    expect(m('Metal shelf, wood-look top')).toBe('metal')
  })
  it('"and" joins adjectives, not items — it does not hide the material that follows', () => {
    expect(m('Durable and Beautiful Wooden Bed', 'beds-mattresses')).toBe('wood')
  })
})

describe('diacritics are the word — nothing is folded', () => {
  it('máy is not mây, trẻ is not tre, đa is not da, kinh is not kính, gõ alone is not gỗ', () => {
    expect(m('Bàn Máy Tính Văn Phòng Cũ', 'tables-desks')).toBeNull()
    expect(m('Giường Tầng Trẻ Em Có Ngăn Kéo', 'beds-mattresses')).toBeNull()
    expect(m('Tủ Đa Năng 4 Tầng')).toBeNull()
    expect(m('Tủ Kinh Doanh Cũ')).toBeNull()
    expect(m('Bàn Gõ Cũ', 'tables-desks')).toBeNull()
  })
  it('whole words only: "treo" is not "tre", "kiến trúc" is not bamboo', () => {
    expect(m('Tủ Bếp Treo Tường')).toBeNull()
    expect(m('Kệ Phong Cách Kiến Trúc Nhật')).toBeNull()
  })
  it('decomposed (NFD), upper-case and punctuated titles read the same', () => {
    expect(m('Giường Gỗ Cũ'.normalize('NFD'), 'beds-mattresses')).toBe('wood')
    expect(m('GIƯỜNG GỖ CŨ', 'beds-mattresses')).toBe('wood')
    expect(m('Kệ/Sắt,Cũ')).toBe('metal')
  })
  it('an UNACCENTED title names no material — "da" there is as likely đã, "tre" trẻ, "nhung" những', () => {
    expect(m('Ban go da qua su dung', 'tables-desks')).toBeNull()
    expect(m('Ghe tre em', 'sofa-seating')).toBeNull()
    expect(m('Sofa nhung mau xam', 'sofa-seating')).toBeNull()
    // …while the same syllables count in an accented title.
    expect(m('Ghế Sofa Da Cũ', 'sofa-seating')).toBe('fabric')
    expect(m('Sofa Nhung Màu Xám', 'sofa-seating')).toBe('fabric')
  })
})

describe('the longest phrase wins, and a material word used for something else is not a mention', () => {
  it('wood GRAIN, wood COLOUR and an imitation are not wood', () => {
    expect(m('Tủ Hồ Sơ Cũ Vân Gỗ Nâu')).toBeNull()
    expect(m('Tủ Đựng Giày Cũ Màu Gỗ')).toBeNull()
    expect(m('Bàn Làm Việc Sắt Vân Gỗ', 'tables-desks')).toBe('metal')
    expect(m('Tủ Giày Tre Giả Gỗ Cũ')).toBe('rattan-bamboo')
  })
  it('a diameter, eyeglasses and a cloud are not glass or rattan', () => {
    expect(m('Bàn Tròn Cũ Đường Kính 80CM', 'tables-desks')).toBeNull()
    expect(m('Tủ Trưng Bày Mắt Kính Cũ')).toBeNull()
    expect(m('Bàn Phòng Ăn Vân Mây Sang Trọng', 'tables-desks')).toBeNull()
    expect(m('Bộ Bàn Ăn 6 Ghế Mặt Vân Đá Mây', 'tables-desks')).toBeNull()
    expect(m('Bàn Trà Gỗ Dáng Mây Bo Tròn', 'tables-desks')).toBe('wood')
  })
  it('a colour named after wood is not wood — "nâu gỗ" is wood-brown, "gỗ nâu" is brown wood', () => {
    expect(readMaterial('Tủ Hồ Sơ Cũ Màu Nâu Gỗ 12 Ngăn', 'storage')).toEqual({ value: null, why: 'none-named' })
    expect(m('Bàn Họp Nâu Gỗ Cũ 3M7x1M8', 'tables-desks')).toBeNull()
    expect(m('Bàn Văn Phòng Cũ Vàng Gỗ Phối Xanh', 'tables-desks')).toBeNull()
    expect(m('Giường Gỗ Nâu Cũ 1M6', 'beds-mattresses')).toBe('wood')
    // …but a colour followed by WHICH wood names it.
    expect(m('Bàn Làm Việc Màu Nâu Đỏ Gỗ Công Nghiệp', 'tables-desks')).toBe('wood')
    expect(m('Tủ Quần Áo Cũ Màu Nâu Gỗ Xoan Đào 4 Cánh')).toBe('wood')
    expect(m('Tủ Quần Áo Gỗ Cũ Màu Vân Nâu Gỗ 2 Cánh')).toBe('wood')
  })
  it('cast ("đúc") is a second material; cast iron ("gang") is metal — in accented titles only', () => {
    expect(readMaterial('Bàn Cafe Gỗ Cũ Chân Ngang Đúc', 'tables-desks')).toEqual({ value: null, why: 'two-materials' })
    expect(readMaterial('Ghế Nhựa Đúc Cũ', 'sofa-seating')).toEqual({ value: null, why: 'outside-taxonomy' })
    expect(m('Bộ Bàn Ghế Gang Cũ', 'tables-desks')).toBe('metal')
    expect(m('ban ghe gang', 'tables-desks')).toBeNull()
  })
  it('rubberwood beats latex, a rosewood beats stone, faux leather is still Fabric/Leather', () => {
    expect(m('Giường Ngủ Gỗ Cao Su 1M6', 'beds-mattresses')).toBe('wood')
    expect(m('Nệm Cao Su Non Dày 10CM', 'beds-mattresses')).toBeNull()
    expect(m('Tủ Quần Áo Gỗ Hương Đá 4 Cánh')).toBe('wood')
    expect(m('Ghế Văn Phòng Giả Da Đen', 'sofa-seating')).toBe('fabric')
    expect(m('Ghế Màu Da Cũ', 'sofa-seating')).toBeNull()
  })
})

describe('two materials, or one outside the taxonomy → null', () => {
  it.each([
    ['Bàn Làm Việc Khung Sắt Mặt Gỗ', 'tables-desks'],
    ['Tủ Bếp Nhôm Kính Cũ', 'storage'],
    ['Tủ Hồ Sơ Gỗ Cánh Kính', 'storage'],
    ['Sofa Da Kèm Bàn Kính', 'sofa-seating'],
    ['Ghế Giám Đốc Bọc Da Chân Gỗ', 'sofa-seating'],
  ])('%s', (title, shelf) => {
    expect(readMaterial(title, shelf)).toEqual({ value: null, why: 'two-materials' })
  })
  it.each([
    ['Ghế Nhựa Cũ Màu Đỏ', 'sofa-seating'],
    ['Bàn Ăn Mặt Đá 6 Ghế', 'tables-desks'],
    ['Ghế Văn Phòng Lưng Lưới', 'sofa-seating'],
    ['Bộ Bàn Ghế Mây Nhựa Cafe', 'tables-desks'],
  ])('%s is outside the taxonomy', (title, shelf) => {
    expect(readMaterial(title, shelf)).toEqual({ value: null, why: 'outside-taxonomy' })
  })
  it('a plastic chair on iron legs is not a metal chair', () => {
    expect(m('Ghế Nhựa Chân Sắt', 'sofa-seating')).toBeNull()
  })
})

describe('a part’s or an accessory’s material is never the item’s', () => {
  it.each([
    ['Bàn Làm Việc Cũ Màu Trắng Chân Sắt', 'tables-desks'], // legs — the top is unnamed
    ['Thanh Lý Ghế Bar Chân Trụ Inox', 'sofa-seating'], // a pedestal leg
    ['Tủ Hồ Sơ 2 Cánh Kính Màu Trắng', 'storage'], // glass doors
    ['Tủ Locker 3 Cánh Mặt Kính', 'storage'], // glass-faced doors
    ['Bàn Làm Việc Có Vách Kính', 'tables-desks'], // a glass partition
    ['Bộ Sofa Cũ Kèm Đôn Và Bàn Kính', 'sofa-seating'], // a glass table sold WITH the sofa
    ['Ghế Nail Cũ Có Hộc Tủ Gỗ', 'sofa-seating'], // a wooden cabinet on a nail chair
    ['Giường Ngủ Cũ Đầu Giường Bọc Da', 'beds-mattresses'], // a leather headboard
    ['Bộ Bàn Ăn 1M4 Cũ 4 Ghế Bọc Da', 'tables-desks'], // the chairs' upholstery, not the table's
    ['Ghế Xoay Cũ Đệm Vải Màu Đỏ', 'sofa-seating'], // a cushion
    ['Desk with metal legs', 'tables-desks'],
  ])('%s', (title, shelf) => {
    expect(readMaterial(title, shelf)).toEqual({ value: null, why: 'only-a-part' })
  })
  it('…but a frame, a top, wooden doors, a nightstand, upholstery and a dining SET are the item’s own', () => {
    expect(m('Giường Đơn Khung Sắt Cũ', 'beds-mattresses')).toBe('metal')
    expect(m('Bàn Trà Mặt Kính Đen', 'tables-desks')).toBe('glass')
    expect(m('Tủ Áo Cũ 3 Cánh Gỗ Nâu Đỏ')).toBe('wood')
    expect(m('Tủ Đầu Giường Gỗ Cũ 2 Ngăn Kéo')).toBe('wood')
    expect(m('Ghế Cafe Cũ Bọc Nệm Da Đen', 'sofa-seating')).toBe('fabric')
    expect(m('Ghế Văn Phòng Chân Quỳ Bọc Da Màu Đen', 'sofa-seating')).toBe('fabric')
    expect(m('Bộ Bàn Ăn 6 Ghế Gỗ Tràm Màu Nâu', 'tables-desks')).toBe('wood')
    expect(m('Bộ Bàn Ghế Gỗ Cũ Có Ghế Băng', 'tables-desks')).toBe('wood')
    expect(m('Giường Cũ 1M8x2M Với Chất Liệu Gỗ Bền Bỉ', 'beds-mattresses')).toBe('wood')
  })
  it('"20+" is a count, not an accessory', () => {
    expect(m('Xả Kho 20+ Mẫu Ghế Gỗ', 'sofa-seating')).toBe('wood')
  })
  it('a TOP is the table only when the title describes nothing under it', () => {
    expect(m('Bàn Sofa Mặt Kính Cũ', 'tables-desks')).toBe('glass')
    expect(m('Bàn Họp Khung Sắt Cũ', 'tables-desks')).toBe('metal')
    for (const title of [
      'Bàn Làm Việc Mặt Gỗ 1M2x80CM Chân Chữ U Màu Trắng', // a wood top on a U-frame of something
      'Bàn Sofa Mặt Kính Cũ Khung Hoa Văn Cổ Điển', // a glass top on an ornamental frame of something
      'Bàn Họp Cũ Mặt Vân Gỗ Nâu Khung Sắt', // an iron frame under a wood-grain top of something
    ]) expect(readMaterial(title, 'tables-desks'), title).toEqual({ value: null, why: 'only-a-part' })
  })
  it('…and on anything but a table, a top, a seat or a face is a part', () => {
    for (const [title, shelf] of [
      ['Ghế Đôn Cũ Mặt Gỗ Khung Chắc Chắn', 'sofa-seating'], // a stool's seat
      ['Quầy Lễ Tân Cũ Phối Màu Trắng Xanh Mặt Kính', 'tables-desks'], // a counter's top
      ['Kệ Tivi Cũ Mặt Kính Màu Đen', 'storage'], // a TV stand's top
      ['Quầy Cũ 1M2 Mặt Nan Gỗ Tạo Điểm Nhấn', 'tables-desks'], // a slatted accent face
      ['Thanh lý tủ trưng bày 1m2 x 2m4 ngăn kính', 'storage'], // glass shelves, the body unnamed
    ] as const) expect(readMaterial(title, shelf), title).toEqual({ value: null, why: 'only-a-part' })
    expect(m('Giường Cũ 1M6X2M Màu Nâu Đậm Nan Gỗ Dày', 'beds-mattresses')).toBe('wood') // slats ARE the bed
  })
  it('the felt or leather of a table-and-chairs set is the chairs’', () => {
    expect(readMaterial('Bộ Bàn Ghế Cà Phê Bọc Nỉ Cũ Nâu', 'sofa-seating')).toEqual({ value: null, why: 'only-a-part' })
    expect(m('Ghế Bàn Ăn Cũ Màu Xanh Bọc Vải', 'sofa-seating')).toBe('fabric') // a dining CHAIR
  })
  it('materialMentions says which mention is a part', () => {
    expect(materialMentions('Ghế Giám Đốc Bọc Da Chân Gỗ')).toEqual([
      { phrase: 'da', reading: 'fabric', part: false },
      { phrase: 'gỗ', reading: 'wood', part: true },
    ])
  })
})

describe('readMaterial reasons and the shelf', () => {
  it('names why a title stayed empty', () => {
    expect(readMaterial('Tủ Quần Áo Cũ 3 Cánh', 'storage')).toEqual({ value: null, why: 'none-named' })
    expect(readMaterial('', 'storage')).toEqual({ value: null, why: 'none-named' })
    expect(readMaterial(null, 'storage')).toEqual({ value: null, why: 'none-named' })
    expect(readMaterial('Tủ Lạnh Inox', 'white-goods')).toEqual({ value: null, why: 'not-offered' })
  })
})

describe('ownWordsTitle — the merchant’s words, never the translation', () => {
  it('reads titleVi on an imported row and title on a human post', () => {
    expect(ownWordsTitle({ title: 'Luxury Rattan Dining Table', titleVi: 'Bàn Phòng Ăn Vân Mây Sang Trọng' })).toBe('Bàn Phòng Ăn Vân Mây Sang Trọng')
    expect(materialFromTitle(ownWordsTitle({ title: 'Luxury Rattan Dining Table', titleVi: 'Bàn Phòng Ăn Vân Mây Sang Trọng' }), 'tables-desks')).toBeNull()
    expect(ownWordsTitle({ title: 'Used Wooden Bed', titleVi: null })).toBe('Used Wooden Bed')
    expect(ownWordsTitle({ title: 'Used Wooden Bed', titleVi: '   ' })).toBe('Used Wooden Bed')
  })
})

describe('decideTitleMaterial — the importer hook: FILLS, NEVER OVERWRITES', () => {
  const base = { categorySlug: MATERIAL_CATEGORY, subcategorySlug: 'beds-mattresses', title: 'Giường Gỗ Cũ' }
  it('writes the material on a row with no attributes, as the needle the chips and the band read', () => {
    const d = decideTitleMaterial({ ...base, attributes: null })
    expect(d).toEqual({ write: true, material: 'wood', attributes: '{"material":"wood"}' })
    if (!d.write) throw new Error('unreachable')
    expect(attrMatcher('material', 'wood')({ attributes: d.attributes })).toBe(true)
    expect(fallbackBandKey({ categorySlug: MATERIAL_CATEGORY, subcategorySlug: 'beds-mattresses', attributes: d.attributes })).toBe('material=wood')
  })
  it('keeps every other attribute', () => {
    expect(attributesWithTitleMaterial({ ...base, attributes: '{"condition":"used","color":"brown"}' })).toBe('{"condition":"used","color":"brown","material":"wood"}')
    expect(attributesWithTitleMaterial({ ...base, attributes: '' })).toBe('{"material":"wood"}')
  })
  it('never touches a row that already has a material — whatever it says, even empty', () => {
    expect(decideTitleMaterial({ ...base, attributes: '{"material":"metal"}' })).toEqual({ write: false, why: 'has-material' })
    expect(decideTitleMaterial({ ...base, attributes: '{"material":""}' })).toEqual({ write: false, why: 'has-material' })
    expect(decideTitleMaterial({ ...base, attributes: '{"material":"gỗ sồi"}' })).toEqual({ write: false, why: 'has-material' })
  })
  it('leaves attributes it cannot read alone', () => {
    expect(decideTitleMaterial({ ...base, attributes: '{oops' })).toEqual({ write: false, why: 'unreadable-attributes' })
    expect(decideTitleMaterial({ ...base, attributes: '["wood"]' })).toEqual({ write: false, why: 'unreadable-attributes' })
    expect(decideTitleMaterial({ ...base, attributes: '"wood"' })).toEqual({ write: false, why: 'unreadable-attributes' })
  })
  it('only on a furniture shelf that offers the facet — electronics has a `storage` shelf too', () => {
    expect(decideTitleMaterial({ ...base, categorySlug: 'electronics', subcategorySlug: 'storage', title: 'Ổ Cứng Kim Loại', attributes: null })).toEqual({ write: false, why: 'not-a-material-shelf' })
    expect(decideTitleMaterial({ ...base, subcategorySlug: 'white-goods', title: 'Tủ Lạnh Inox', attributes: null })).toEqual({ write: false, why: 'not-a-material-shelf' })
    expect(decideTitleMaterial({ ...base, subcategorySlug: null, attributes: null })).toEqual({ write: false, why: 'not-a-material-shelf' })
  })
  it('passes the title’s reason through when it names nothing usable', () => {
    expect(decideTitleMaterial({ ...base, title: 'Giường Gỗ Khung Sắt', attributes: null })).toEqual({ write: false, why: 'two-materials' })
  })
})

describe('titleMaterialFill — the refresh-side compare-and-set', () => {
  const row = { id: 'l1', categorySlug: MATERIAL_CATEGORY, subcategorySlug: 'storage' }
  it('fills only while the row is live and its attributes are still what was read', () => {
    expect(titleMaterialFill({ ...row, attributes: null }, 'Kệ Sắt Cũ')).toEqual({
      material: 'metal',
      update: { where: { id: 'l1', status: { in: ['active', 'sold'] }, subcategorySlug: 'storage', attributes: null }, data: { attributes: '{"material":"metal"}' } },
    })
    expect(titleMaterialFill({ ...row, attributes: '{"color":"black"}' }, 'Kệ Sắt Cũ')!.update.where.attributes).toBe('{"color":"black"}')
  })
  it('is null when the row has a material or the title names none', () => {
    expect(titleMaterialFill({ ...row, attributes: '{"material":"wood"}' }, 'Kệ Sắt Cũ')).toBeNull()
    expect(titleMaterialFill({ ...row, attributes: null }, 'Kệ Trưng Bày Cũ')).toBeNull()
  })

  /** A mock `db.listing.updateMany` with Prisma's semantics for exactly the where this hook builds. */
  function mockDb(stored: { id: string; status: string; subcategorySlug?: string; attributes: string | null }) {
    return {
      listing: {
        updateMany: async (args: { where: { id: string; status: { in: string[] }; subcategorySlug: string; attributes: string | null }; data: { attributes: string } }) => {
          const hit = stored.id === args.where.id && args.where.status.in.includes(stored.status)
            && (stored.subcategorySlug ?? 'storage') === args.where.subcategorySlug && stored.attributes === args.where.attributes
          if (hit) stored.attributes = args.data.attributes
          return { count: hit ? 1 : 0 }
        },
      },
    }
  }
  it('with a mocked db: a material written between the importer’s read and its fill is never overwritten', async () => {
    const stored = { id: 'l1', status: 'active', attributes: null as string | null }
    const fill = titleMaterialFill({ ...row, attributes: stored.attributes }, 'Kệ Sắt Cũ')!
    stored.attributes = '{"material":"wood"}' // the seller, or a moderator, in between
    expect(await mockDb(stored).listing.updateMany(fill.update)).toEqual({ count: 0 })
    expect(stored.attributes).toBe('{"material":"wood"}')
  })
  it('with a mocked db: a row re-filed to another shelf in between is not this decision’s', async () => {
    const moved = { id: 'l1', status: 'active', subcategorySlug: 'storage', attributes: null as string | null }
    const fill = titleMaterialFill({ ...row, attributes: null }, 'Kệ Sắt Cũ')!
    moved.subcategorySlug = 'lighting-decor'
    expect(await mockDb(moved).listing.updateMany(fill.update)).toEqual({ count: 0 })
    expect(moved.attributes).toBeNull()
  })
  it('with a mocked db: a row hidden in between is not touched; an untouched live row is filled', async () => {
    const hidden = { id: 'l1', status: 'active', attributes: null as string | null }
    const fill = titleMaterialFill({ ...row, attributes: null }, 'Kệ Sắt Cũ')!
    hidden.status = 'hidden'
    expect(await mockDb(hidden).listing.updateMany(fill.update)).toEqual({ count: 0 })
    expect(hidden.attributes).toBeNull()
    const live = { id: 'l1', status: 'sold', attributes: null as string | null }
    expect(await mockDb(live).listing.updateMany(fill.update)).toEqual({ count: 1 })
    expect(live.attributes).toBe('{"material":"metal"}')
  })
})

/**
 * ⚠️ A SOURCE SCAN, like partner-import-rules.test.ts's: scripts/import-partners.ts opens the database at
 * module scope, so the hook is pinned by what the script says.
 */
describe('scripts/import-partners.ts — the material hook', () => {
  const src = readFileSync('scripts/import-partners.ts', 'utf8')
  it('reads the row’s attributes, so the refresh can tell an empty material from a set one', () => {
    expect(src).toMatch(/select: \{[^}]*attributes: true \} \}\)/)
  })
  it('writes the title’s material on CREATE only — `attributes` is out of the refresh set', () => {
    expect(src).toMatch(/attributes: newMaterial\?\.write \? newMaterial\.attributes : undefined,/)
    expect(src).toMatch(/attributes: _a, condition: _c, \.\.\.refreshable \} = fields/)
  })
  it('fills an existing row through titleMaterialFill, after the refresh, in its own statement', () => {
    expect(src).toMatch(/titleMaterialFill\(\{ id: existing\.id, attributes: existing\.attributes,/)
    expect(src).toMatch(/if \(!\(await refreshLive\(\)\)\) \{ drop\('not live at write time — left untouched'\); return \}\s*await fillMaterial\(\)/)
    expect(src).toMatch(/await db\.listing\.updateMany\(materialFill\.update\)/)
  })
})
