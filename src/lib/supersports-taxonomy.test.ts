import { describe, expect, it } from 'vitest'
import { facetValues } from './facet-tokens'
import {
  SS_GROUP, apparelSizeBuckets, colorBucketFor, genderFromTitle, groupFor,
  placementFor, shoeSizeBuckets, sizesLabel, sportsFor, supersportsFacets,
} from './supersports-taxonomy'
import { CATEGORY_BY_SLUG } from './taxonomy'

/**
 * The 94 `product_type` values measured on the live SuperSports catalogue on 2026-09-17 (5,978
 * products). This list is the contract: if the merchant renames a type, the mapping must be
 * updated rather than quietly falling through to a keyword rule.
 */
const MEASURED_TYPES = [
  'Ba Lô', 'Banh Bóng Ném', 'Banh Bóng Pickleball', 'Banh Bóng Rổ', 'Banh Bóng Đá', 'Bình Nước',
  'Băng Đô', 'Chân Váy', 'Chăm Sóc Giày', 'Clog', 'Cầu Bay', 'Dây Kính Bơi', 'Dép Quai Ngang',
  'Dép Xỏ Ngón', 'Dụng Cụ Bơi & Thể Thao Biển', 'Dụng Cụ Massage', 'Dụng Cụ Tập Bóng Đá',
  'Dụng Cụ Tập Golf', 'Dụng Cụ Tập Gym', 'Dụng Cụ Tập Yoga', 'Gel Năng Lượng', 'Ghế Massage',
  'Giày Bóng Rổ', 'Giày Chạy Bộ', 'Giày Clog', 'Giày Golf', 'Giày Leo Núi', 'Giày Luyện Tập',
  'Giày Pickleball', 'Giày Sandals', 'Giày Slip-On', 'Giày Sneakers / Giày Thời Trang',
  'Giày Tennis', 'Giày Thể Thao Đa Năng', 'Giày Đá Bóng', 'Găng Tay Gym', 'Găng Tay Thể Thao',
  'Jibbitz', 'Khăn Thể Thao Đa Năng', 'Kính Bơi', 'Kính Thể Thao', 'Máy Chèo Thuyền Và Tập Cơ',
  'Máy Chạy Bộ', 'Máy Tập Liên Hoàn', 'Mũ / Nón', 'Mũ / Nón Bơi', 'Mũ Len', 'Mũ Lưỡi Trai',
  'Mũ Xô (Bucket)', 'Phao Bơi', 'Phụ Kiện', 'Phụ Kiện Thể Thao', 'Phụ Kiện Xe Đạp',
  'Pickleball Balls', 'Quà Lưu Niệm', 'Quần Bó Thể Thao', 'Quần Bơi', 'Quần Dài Thể Thao',
  'Quần Jogger', 'Quần Lót', 'Quần Ngắn Thể Thao', 'Quần Ngắn Thời Trang', 'Thanh Năng Lượng',
  'Thắt Lưng', 'Tròng Kính Bơi', 'Túi Bao Tử', 'Túi Thể Thao', 'Túi Tote', 'Túi Trống',
  'Túi Đeo Chéo', 'Ván Trượt', 'Vớ / Tất', 'Vợt', 'Xe Scooter', 'Xe Đạp', 'Xe Đạp Trong Nhà',
  'Áo Ba Lỗ', 'Áo Bơi', 'Áo Crop-Top', 'Áo Hoodie', 'Áo Khoác', 'Áo Lót', 'Áo Nỉ', 'Áo Phao',
  'Áo Polo', 'Áo Sơ Mi', 'Áo Thun', 'Áo Tập Nữ / Áo Bra', 'Áo Đá Bóng', 'Đĩa Ném', 'Đầm',
  'Đồ Bơi Hai Mảnh', 'Đồ Bơi Một Mảnh', 'Đồ Bảo Hộ Thể Thao',
]

describe('supersports placement', () => {
  it('maps every product type the live catalogue actually uses', () => {
    expect(MEASURED_TYPES).toHaveLength(94)
    const unmapped = MEASURED_TYPES.filter((t) => !SS_GROUP[t])
    expect(unmapped).toEqual([])
  })

  it('files every group on a shelf that exists in the taxonomy', () => {
    const sports = new Set(CATEGORY_BY_SLUG.sports.subcategories.map((s) => s.slug))
    const kids = new Set(CATEGORY_BY_SLUG['baby-kids'].subcategories.map((s) => s.slug))
    for (const t of MEASURED_TYPES) {
      const adult = placementFor(t, "Men's Nike Something")
      expect(adult.categorySlug).toBe('sports')
      expect(sports.has(adult.subcategorySlug!)).toBe(true)
      const kid = placementFor(t, "Kids' Nike Something")
      expect(kid.categorySlug).toBe('baby-kids')
      expect(kids.has(kid.subcategorySlug!)).toBe(true)
    }
  })

  it('treats slides and flip-flops as footwear, not accessories', () => {
    expect(placementFor('Dép Quai Ngang', "Men's Nike Air Max Cirro Slides - Beige").subcategorySlug).toBe('sports-shoes')
    expect(placementFor('Dép Xỏ Ngón', "Men's Teva Mush II Flip-Flops - Blue").subcategorySlug).toBe('sports-shoes')
    expect(placementFor('Giày Clog', 'Unisex Crocs Classic Evo Gum Clogs - Green').subcategorySlug).toBe('sports-shoes')
  })

  it("does not call a child's goggles or football clothing", () => {
    expect(placementFor('Kính Bơi', "Kids' Speedo Vanquisher Goggles").subcategorySlug).toBe('baby-gear')
    expect(placementFor('Banh Bóng Đá', "Boys' Puma Futsal Football").subcategorySlug).toBe('toys')
    expect(placementFor('Xe Scooter', "Kid's Spartan Ziggy Scooter").subcategorySlug).toBe('toys')
    expect(placementFor('Quần Bơi', "Boys' Speedo Watershorts").subcategorySlug).toBe('kids-clothing')
    expect(placementFor('Giày Sandals', "Kids' Teva Hurricane Sandals - Pink").subcategorySlug).toBe('kids-shoes')
  })

  it("files a kid's product in the Kids aisle even when only the Vietnamese row exists", () => {
    // The English locale had not published this product yet, so the title reaching us is Vietnamese
    // and carries no "Kids'" prefix — the merchant's own tag and wording still say whose it is.
    expect(placementFor('Giày Sandals', 'Giày Sandals Trẻ Em Teva Hurricane', { tags: ['Kids'] }))
      .toMatchObject({ categorySlug: 'baby-kids', subcategorySlug: 'kids-shoes' })
    expect(placementFor('Giày Sandals', 'Giày Sandals Bé Gái Teva', { viTitle: 'Giày Sandals Bé Gái Teva' }))
      .toMatchObject({ categorySlug: 'baby-kids' })
    // and an adult product with an adult tag set stays where it is
    expect(placementFor('Giày Chạy Bộ', 'Giày Chạy Bộ Nam Nike', { tags: ['Nam', 'Chạy bộ'] }))
      .toMatchObject({ categorySlug: 'sports', subcategorySlug: 'sports-shoes' })
  })

  it('never lets a merchandising tag outvote an explicit adult title', () => {
    // ⛔ The trap the kid cross-check created: tags are a merchandising surface (145 Jibbitz carry
    // Nam AND Nữ AND Unisex), so a `Kids` tag on a men's shoe must not move it into the Kids aisle —
    // where it would also lose its shoe sizes and be pinned for ever.
    const f = supersportsFacets({
      productType: 'Giày Chạy Bộ', enTitle: "Men's Nike Pegasus Running Shoes - Black",
      tags: ['Kids', 'Chạy bộ'], sizes: ['US 8', 'US 9'], color: 'BLACK',
    })
    expect(f).toMatchObject({ categorySlug: 'sports', subcategorySlug: 'sports-shoes', gender: 'men' })
    expect(f.attributes.kidsGender).toBeUndefined()
    expect(facetValues(f.facetTokens, 'shoeSize')).toEqual(['eu-41', 'eu-42'])
  })

  it("reads a Vietnamese-only ADULT product's gender, so its shoe sizes convert on the right chart", () => {
    // No English row yet, so both titles are the Vietnamese one. US 8 is EU 39 for a woman and
    // EU 41 for a man — reading the wrong chart is two whole sizes.
    const women = supersportsFacets({
      productType: 'Giày Chạy Bộ', enTitle: 'Giày Chạy Bộ Nữ Nike Pegasus', viTitle: 'Giày Chạy Bộ Nữ Nike Pegasus',
      tags: ['Chạy bộ'], sizes: ['US 8'], color: 'ĐEN',
    })
    expect(women.gender).toBe('women')
    expect(facetValues(women.facetTokens, 'shoeSize')).toEqual(['eu-39'])
    // ⚠️ and an ENGLISH title that simply states no gender keeps saying nothing — the Vietnamese
    // fallback is for a missing English row, not for a product the merchant left unlabelled.
    const socks = supersportsFacets({
      productType: 'Vớ / Tất', enTitle: 'Under Armour Performance Socks', viTitle: 'Vớ Nam Under Armour',
      tags: [], sizes: ['M'], color: 'TRẮNG', enMissing: false,
    })
    expect(socks.gender).toBe(null)
    expect(socks.attributes.gender).toBeUndefined()
  })

  it("reads a Vietnamese-only child's product without inventing a gender", () => {
    const girl = supersportsFacets({
      productType: 'Giày Sandals', enTitle: 'Giày Sandals Bé Gái Teva', viTitle: 'Giày Sandals Bé Gái Teva',
      tags: ['Kids'], sizes: ['US C10'], color: 'HỒNG',
    })
    expect(girl).toMatchObject({ categorySlug: 'baby-kids', subcategorySlug: 'kids-shoes' })
    expect(girl.attributes.kidsGender).toBe('girl')
    // a product that is only a child's BY TAG says nothing about who it is for, and neither do we
    const unknown = supersportsFacets({
      productType: 'Giày Sandals', enTitle: 'Giày Sandals Teva', viTitle: 'Giày Sandals Teva',
      tags: ['Kids'], sizes: ['US C10'], color: 'ĐEN',
    })
    expect(unknown.categorySlug).toBe('baby-kids')
    expect(unknown.attributes.kidsGender).toBeUndefined()
  })

  it('falls back on a type the merchant adds later, and gives up rather than guessing', () => {
    expect(groupFor('Giày Chạy Bộ Trail')).toBe('footwear')
    expect(groupFor('Áo Gió Chạy Bộ')).toBe('apparel')
    expect(groupFor('Kính Bơi Cận')).toBe('swim-gear')
    expect(groupFor('')).toBe(null)
    expect(groupFor('Voucher')).toBe(null)
    // an unmapped type still files in the right AISLE, with no shelf — the importer counts these
    expect(placementFor('Voucher', "Men's Nike Voucher")).toMatchObject({ categorySlug: 'sports', subcategorySlug: null })
  })
})

describe('supersports gender', () => {
  it('reads the English title prefix, in every spelling the catalogue uses', () => {
    expect(genderFromTitle("Men's Nike Dri-Fit Form Gx Jacket - Black")).toBe('men')
    expect(genderFromTitle("Women'S Under Armour Vest")).toBe('women')
    expect(genderFromTitle('Unisex Crocs Classic Evo Gum Clogs - Green')).toBe('unisex')
    expect(genderFromTitle("Kids' Speedo Vanquisher 3.0 Goggles")).toBe('kids')
    expect(genderFromTitle("Kid's Spartan Ziggy Scooter")).toBe('kids')
    expect(genderFromTitle("Boys' Speedo Printed Swim Vest - Green")).toBe('boy')
    expect(genderFromTitle("Girls' Nike Swim Bikini Set - Pink")).toBe('girl')
  })

  it('says nothing when the merchant says nothing', () => {
    expect(genderFromTitle('Under Armour No Weigh Lite Backpack')).toBe(null)
    expect(genderFromTitle('Speedo Bubble Active + Swim Cap - White')).toBe(null)
    // a "men" inside the title is not a prefix claim
    expect(genderFromTitle('Columbia Freezer Zero Gloves For Men')).toBe(null)
  })
})

describe('supersports sizes', () => {
  it('buckets letter sizes, including the Asian and US letter prefixes', () => {
    expect(apparelSizeBuckets(['XS', 'S', 'M', 'L', 'XL'])).toEqual(['xs-s', 'm', 'l', 'xl-up'])
    expect(apparelSizeBuckets(['A/S', 'A/M', 'A/XL'])).toEqual(['xs-s', 'm', 'xl-up'])
    expect(apparelSizeBuckets(['US/S', 'US/XS'])).toEqual(['xs-s'])
    expect(apparelSizeBuckets(['ONE SIZE'])).toEqual(['free-size'])
    expect(apparelSizeBuckets(['S/M', 'L/XL'])).toEqual(['xs-s', 'm', 'l', 'xl-up'])
  })

  it('refuses to read a chest measurement or a child age as a clothing size', () => {
    expect(apparelSizeBuckets(['30', '32', '34', '36'])).toEqual([])
    expect(apparelSizeBuckets(['5-6 YRS', '7-8 YRS'])).toEqual([])
  })

  it("converts US and UK shoe sizes on the wearer's own chart", () => {
    // US M8 is EU 41; US W8 is EU 39 — the bug this test exists for
    expect(shoeSizeBuckets(['US 8'], 'men')).toEqual(['eu-41'])
    expect(shoeSizeBuckets(['US 8'], 'women')).toEqual(['eu-39'])
    expect(shoeSizeBuckets(['UK 8'], 'men')).toEqual(['eu-42'])
    expect(shoeSizeBuckets(['UK 8'], 'women')).toEqual(['eu-42'])
    // half sizes floor into their bucket, and a run collapses to distinct buckets
    expect(shoeSizeBuckets(['US 7', 'US 7.5', 'US 8'], 'men')).toEqual(['eu-40', 'eu-41'])
    // everything from 44 up is one bucket
    expect(shoeSizeBuckets(['US 10', 'US 11', 'US 12'], 'men')).toEqual(['eu-44-plus'])
    // Crocs dual sizing reads the men's number
    expect(shoeSizeBuckets(['US M7W9'], 'unisex')).toEqual(['eu-40'])
    // ⚠️ and the chart must REACH Crocs' small sizes: `US M3W5`…`US M6W8` is 410 products, and a
    // chart starting at 5 silently produced no size for any of them.
    expect(shoeSizeBuckets(['US M3W5', 'US M4W6', 'US M6W8'], 'unisex')).toEqual(['eu-35', 'eu-36', 'eu-38'])
    // a size that names its own chart beats the title's gender
    expect(shoeSizeBuckets(['US W5', 'US W9'], 'unisex')).toEqual(['eu-35', 'eu-40'])
    expect(shoeSizeBuckets(['US M7'], 'women')).toEqual(['eu-40'])
    // ⛔ unisex dual sizing is MEN'S/WOMEN'S, men first — the same shop spells Crocs out as
    // `US M4W6`, and the 1.5 gap is the men↔women offset. Reading the second number would put every
    // one of these 94 products a size and a half too big.
    expect(shoeSizeBuckets(['US 5.5/7'], 'unisex')).toEqual(['eu-38'])
    expect(shoeSizeBuckets(['US 7/8.5'], 'unisex')).toEqual(['eu-40'])
    expect(shoeSizeBuckets(['US 5/6', 'US 5.5/6.5'], null)).toEqual(['eu-37', 'eu-38'])
    expect(shoeSizeBuckets(['EU 42'], null)).toEqual(['eu-42'])
    expect(shoeSizeBuckets(['ONE SIZE'], null)).toEqual(['free-size'])
  })

  it('produces no shoe size at all for a system it cannot convert', () => {
    expect(shoeSizeBuckets(['US C6', 'US C10'], 'kids')).toEqual([])
    expect(shoeSizeBuckets(['5-6 YRS'], 'kids')).toEqual([])
    expect(shoeSizeBuckets(['23', '26'], null)).toEqual([])
    // a child's US 1 would convert to EU 33 on the adult chart — below the chips, so dropped
    expect(shoeSizeBuckets(['US 1'], 'men')).toEqual([])
  })

  it('lists the sizes rather than implying a continuous run', () => {
    expect(sizesLabel(['US 7', 'US 7.5', 'US 8'])).toBe('US 7, US 7.5, US 8')
    // the trap: a partially sold-out shoe must not read as "US 6–US 12"
    expect(sizesLabel(['US 6', 'US 12'])).toBe('US 6, US 12')
    expect(sizesLabel(['ONE SIZE'])).toBe('ONE SIZE')
    expect(sizesLabel(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'])).toBe('XS, S, M, L, XL, XXL +2')
    expect(sizesLabel([])).toBe(null)
  })
})

describe('supersports colour and sport', () => {
  it('maps the merchant colours onto the app buckets', () => {
    expect(colorBucketFor('BLACK')).toBe('black')
    expect(colorBucketFor('NAVY')).toBe('blue')
    expect(colorBucketFor('ARMY GREEN')).toBe('green')
    expect(colorBucketFor('MINT')).toBe('green')
    expect(colorBucketFor('BEIGE')).toBe('neutral')
    expect(colorBucketFor('CORAL')).toBe('red')
    // deliberately "other" rather than widening a palette every category shares
    expect(colorBucketFor('PINK')).toBe('other')
    expect(colorBucketFor('MULTICOLOR')).toBe('other')
    expect(colorBucketFor('')).toBe(null)
  })

  it('takes every sport a product belongs to, from tags and from its type', () => {
    expect(sportsFor(['Chạy bộ', 'Luyện tập', 'Fullprice'], 'Giày Chạy Bộ').sort()).toEqual(['running', 'training'])
    expect(sportsFor([], 'Kính Bơi')).toEqual(['swimming'])
    expect(sportsFor(['SS26'], 'Áo Thun')).toEqual([])
  })
})

describe('supersportsFacets', () => {
  it("writes a men's running shoe the way browse will read it", () => {
    const f = supersportsFacets({
      productType: 'Giày Chạy Bộ',
      enTitle: "Men's Columbia Konos Flash Trail Running Shoes - Black",
      tags: ['Chạy bộ', 'Footwear'],
      sizes: ['US 7', 'US 7.5', 'US 8', 'US 9'],
      color: 'BLACK',
    })
    expect(f).toMatchObject({ categorySlug: 'sports', subcategorySlug: 'sports-shoes', gender: 'men' })
    expect(f.attributes).toEqual({ gender: 'men', color: 'black', sizes: 'US 7, US 7.5, US 8, US 9' })
    expect(facetValues(f.facetTokens, 'shoeSize')).toEqual(['eu-40', 'eu-41', 'eu-42'])
    expect(facetValues(f.facetTokens, 'sport')).toEqual(['running'])
    expect(facetValues(f.facetTokens, 'size')).toEqual([])
  })

  it('asks the Kids aisle its own question, and never asks for a gender there', () => {
    const f = supersportsFacets({
      productType: 'Đồ Bơi Hai Mảnh',
      enTitle: "Girls' Nike Swim Racerback Bikini & Short Set - Pink",
      tags: ['Kids', 'Bơi lội'],
      sizes: ['XS', 'S', 'M'],
      color: 'PINK',
    })
    expect(f).toMatchObject({ categorySlug: 'baby-kids', subcategorySlug: 'kids-clothing' })
    expect(f.attributes.kidsGender).toBe('girl')
    expect(f.attributes.gender).toBeUndefined()
    expect(facetValues(f.facetTokens, 'size')).toEqual(['xs-s', 'm'])
  })

  it('leaves gender out entirely when the merchant states none', () => {
    const f = supersportsFacets({
      productType: 'Vớ / Tất', enTitle: 'Under Armour Performance Cotton 3-Pack Socks',
      tags: ['Luyện tập'], sizes: ['M', 'L'], color: 'WHITE',
    })
    expect(f.attributes.gender).toBeUndefined()
    expect(f.attributes).toMatchObject({ color: 'white', sizes: 'M, L' })
    expect(facetValues(f.facetTokens, 'size')).toEqual(['m', 'l'])
  })
})
