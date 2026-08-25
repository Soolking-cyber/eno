import { describe, expect, it } from 'vitest'
import { matchCrumbs, placementForCrumbs, placementFromTitle } from './merchant-taxonomy'

const p = (...c: string[]) => placementForCrumbs(c)

/**
 * ⛔ EVERY PATH IN THE BLOCKS BELOW IS A REAL ONE, COPIED FROM THE MERCHANT'S OWN CRAWL, and each
 * case failed in production before it was a test. The owner found them the way owners do — by
 * opening the Audio aisle and seeing televisions and microwave ovens in it.
 *
 * The single failure mode they exist to prevent: `placementForCrumbs` takes the FIRST rule that
 * matches the joined path, so a broad rule listed above a specific one silently wins forever. It
 * happened THREE times independently — `hàng cũ.*xiaomi` matching a trailing BRAND crumb and filing
 * used smartwatches as phones; `đồ gia dụng` swallowing its whole department so fans, irons and
 * shavers became kitchenware; and `đồng hồ thông minh` swallowing the watch-STRAP aisle nested
 * inside it. Adding a rule is therefore not enough: it has to go in the right PLACE, and that
 * ordering is what breaks here.
 */
const place = (path: string) => {
  const r = placementForCrumbs(path.split(' > '))
  return r ? `${r.category}/${r.subcategory ?? '—'}` : '(none)'
}

describe('placementForCrumbs — the misfilings this was written to fix', () => {
  // ⛔ Each of these was measured wrong in production on 2026-08-25.
  it('files a laptop sold with a charger as a laptop, not a charger', () => {
    // The title says "70W Charger"; the merchant's own aisle says Laptop.
    expect(p('Root', 'Laptop', 'Apple')).toEqual({ category: 'electronics', subcategory: 'laptops-pcs' })
  })
  it('files a memory card under storage, not cables', () => {
    expect(p('Phụ kiện', 'Thẻ nhớ, USB')).toEqual({ category: 'electronics', subcategory: 'storage' })
  })
  it('files a warranty-exchange iPad as a tablet, not a service', () => {
    expect(p('Root', 'Máy tính bảng', 'iPad Pro')).toEqual({ category: 'electronics', subcategory: 'phones-tablets' })
  })
  // ⛔ "Hàng cũ" is a CONDITION, not a category — used phones must still browse as phones.
  it('routes second-hand stock by what the thing is', () => {
    expect(p('Hàng cũ', 'iPhone cũ')).toEqual({ category: 'electronics', subcategory: 'phones-tablets' })
    expect(p('Hàng cũ', 'Laptop cũ')).toEqual({ category: 'electronics', subcategory: 'laptops-pcs' })
    expect(p('Hàng cũ', 'Đồng hồ thông minh cũ')).toEqual({ category: 'electronics', subcategory: 'smartwatch' })
  })
  it('keeps genuine services as services', () => {
    expect(p('Phụ kiện', 'Apple Care')).toEqual({ category: 'services', subcategory: null })
    expect(p('Phụ kiện', 'Sim Viettel')).toEqual({ category: 'services', subcategory: null })
  })
  it('takes appliances out of electronics entirely', () => {
    expect(p('Điều hòa - Máy lạnh', 'Máy lạnh inverter')).toEqual({ category: 'furniture-appliances', subcategory: 'white-goods' })
    expect(p('Đồ gia dụng', 'Nồi cơm điện')).toEqual({ category: 'furniture-appliances', subcategory: 'kitchenware' })
  })
  it('resolves the big accessory bucket by its second crumb', () => {
    expect(p('Phụ kiện', 'Ốp lưng | Bao da')?.subcategory).toBe('phone-cases')
    expect(p('Phụ kiện', 'Chuột | Bàn Phím')?.subcategory).toBe('keyboards-mice')
    expect(p('Phụ kiện', 'Sạc - Cáp')?.subcategory).toBe('cables-chargers')
    expect(p('Phụ kiện', 'Balo | Túi xách')?.subcategory).toBe('bags-sleeves')
    expect(p('Phụ kiện', 'Pin dự phòng')?.subcategory).toBe('power-banks')
    expect(p('Phụ kiện', 'Dán điện thoại | Laptop')?.subcategory).toBe('screen-protectors')
    expect(p('Phụ kiện', 'Thiết bị mạng')?.subcategory).toBe('networking')
    expect(p('Phụ kiện', 'Camera')?.subcategory).toBe('cameras')
  })
  // ⚠️ The fallback is LAST, so a specific accessory never falls into the generic bucket.
  it('falls back to generic accessories only when nothing more specific matched', () => {
    expect(p('Phụ kiện', 'Phụ kiện tiện ích')?.subcategory).toBe('accessories')
  })
  // ⛔ No rule = no change. A confident wrong answer is worse than none, because nothing revisits it.
  it('returns null rather than guessing', () => {
    expect(p('Root')).toBeNull()
    expect(p()).toBeNull()
    expect(p('Something The Merchant Invented Yesterday')).toBeNull()
  })
})

describe('placementFromTitle — the "Case" trap', () => {
  const cases = { category: 'electronics', subcategory: 'phone-cases' }
  /**
   * ⛔ An Apple Watch is sold as "Aluminum Case Rubber Band" — the case is the watch's BODY. A
   * keyword classifier therefore filed 93 watches under Cases & covers (owner, 2026-08-25:
   * "apple watches in cases subcategory").
   */
  it('rescues a watch that a keyword classifier filed as a case', () => {
    expect(placementFromTitle('Apple Watch SE 3 40mm (5G) Aluminum Case Rubber Band Size S/M', cases))
      .toEqual({ category: 'electronics', subcategory: 'smartwatch' })
    expect(placementFromTitle('Apple Watch Series 10 46mm 4G Aluminum Case', cases)?.subcategory).toBe('smartwatch')
  })
  it('says nothing when the row is already right', () => {
    expect(placementFromTitle('Apple Watch SE 3 40mm', { category: 'electronics', subcategory: 'smartwatch' })).toBeNull()
  })
  // ⚠️ Narrow on purpose: it needs a named watch AND a case size, so a genuine watch STRAP or a
  // phone case that merely mentions a watch is left alone for the breadcrumb to place.
  it('does not grab an accessory that merely names a watch', () => {
    expect(placementFromTitle('Dây đeo cho Apple Watch', cases)).toBeNull()
    expect(placementFromTitle('Ốp lưng iPhone 16 Pro Max', cases)).toBeNull()
  })
})

describe('placementForCrumbs · used stock ("Hàng cũ")', () => {
  it('reads the product type, not the brand crumb that follows it', () => {
    // The regression: the brand sits LAST and `.*` reaches it.
    expect(place('Hàng cũ > Đồng hồ thông minh cũ > Xiaomi')).toBe('electronics/smartwatch')
    expect(place('Hàng cũ > Đồng hồ thông minh cũ > Garmin')).toBe('electronics/smartwatch')
    expect(place('Hàng cũ > Máy ảnh cũ > Sony')).toBe('electronics/cameras')
    expect(place('Hàng cũ > Tai nghe cũ > Tai nghe Apple cũ')).toBe('electronics/audio')
    expect(place('Hàng cũ > Laptop cũ > Asus cũ')).toBe('electronics/laptops-pcs')
  })

  it('still files a bare phone-brand crumb as phones — the fallback must survive the reorder', () => {
    // ⚠️ The other half. The merchant DOES file used phones under a naked brand, so the brand rule
    // has to stay; it just has to be last. Delete it and these three land nowhere.
    expect(place('Hàng cũ > Samsung cũ > Galaxy S cũ > S26 Series cũ')).toBe('electronics/phones-tablets')
    expect(place('Hàng cũ > Xiaomi cũ > Redmi cũ')).toBe('electronics/phones-tablets')
    expect(place('Hàng cũ > OPPO cũ > OPPO A Series cũ')).toBe('electronics/phones-tablets')
    expect(place('Hàng cũ > Điện thoại cũ > Android cũ')).toBe('electronics/phones-tablets')
    expect(place('Hàng cũ > iPad cũ > iPad Pro cũ')).toBe('electronics/phones-tablets')
    expect(place('Hàng cũ > Apple Watch cũ > Series 11')).toBe('electronics/smartwatch')
  })

  it('separates accessory sub-types from the undifferentiated accessories bucket', () => {
    // Power banks before chargers — "pin sạc dự phòng" contains "sạc".
    expect(place('Hàng cũ > Phụ kiện cũ > Pin sạc dự phòng')).toBe('electronics/power-banks')
    expect(place('Hàng cũ > Phụ kiện cũ > Cáp, sạc')).toBe('electronics/cables-chargers')
    expect(place('Hàng cũ > Phụ kiện cũ')).toBe('electronics/accessories')
    expect(place('Hàng cũ > Đồ gia dụng cũ')).toBe('furniture-appliances/kitchenware')
  })
})

describe('placementForCrumbs · home appliances ("Đồ gia dụng")', () => {
  it('routes what is not a kitchen appliance out of the kitchen', () => {
    expect(place('Đồ gia dụng > Quạt > Quạt đứng')).toBe('furniture-appliances/white-goods')
    expect(place('Đồ gia dụng > Bàn ủi')).toBe('furniture-appliances/white-goods')
    expect(place('Đồ gia dụng > Cây nước nóng lạnh')).toBe('furniture-appliances/white-goods')
    expect(place('Đồ gia dụng > Máy hút ẩm')).toBe('furniture-appliances/white-goods')
    // Personal care is not an appliance aisle at all.
    expect(place('Đồ gia dụng > Máy cạo râu > Máy cạo râu Philips')).toBe('fashion-beauty/beauty')
  })

  it('keeps the actual kitchen appliances in the kitchen', () => {
    expect(place('Đồ gia dụng > Nồi cơm điện > Nồi cơm điện nắp rời/nắp gài')).toBe('furniture-appliances/kitchenware')
    expect(place('Đồ gia dụng > Lò vi sóng')).toBe('furniture-appliances/kitchenware')
    expect(place('Đồ gia dụng > Ấm siêu tốc > Sunhouse')).toBe('furniture-appliances/kitchenware')
    expect(place('Đồ gia dụng > Nồi chiên không dầu')).toBe('furniture-appliances/kitchenware')
    expect(place('Đồ gia dụng > Máy ép trái cây')).toBe('furniture-appliances/kitchenware')
    expect(place('Đồ gia dụng > Bếp điện')).toBe('furniture-appliances/kitchenware')
  })
})

describe('placementForCrumbs · the aisles the owner reported', () => {
  it('keeps televisions and microwaves out of Audio', () => {
    // The original report, in one test: "audio subcat shows tvs and microwaves".
    expect(place('Tivi > LG > Tivi LG 55 inch')).toBe('electronics/tv-monitors')
    expect(place('Đồ gia dụng > Đồ gia dụng nhà bếp')).toBe('furniture-appliances/kitchenware')
    expect(place('Âm thanh > Loa > Loa kiểm âm')).toBe('electronics/audio')
    expect(place('Âm thanh > Tai nghe > Tai nghe Bluetooth')).toBe('electronics/audio')
  })
})

describe('placementFromTitle · when the breadcrumb is silent', () => {
  const acc = { category: 'electronics', subcategory: 'accessories' }
  const at = (title: string) => {
    const p = placementFromTitle(title, acc)
    return p ? `${p.category}/${p.subcategory ?? '—'}` : 'null'
  }

  it('separates a watch from a watch BAND by the size list, not the noun', () => {
    /**
     * ⛔ BOTH OF THESE END IN "Band". The noun cannot decide it; the size can — a watch has ONE
     * size, a strap advertises every size it fits. Getting this backwards either fills the Cases
     * aisle with watches (the original bug this function was written for) or the Smartwatch aisle
     * with straps (what a naive accessory-noun guard did on its first try).
     */
    expect(at('Apple Watch SE 3 40mm (5G) Aluminum Case Rubber Band')).toBe('electronics/smartwatch')
    expect(at('Otterbox Apple Watch 40/41/42mm Band')).toBe('null')
    expect(at('Apple Watch Devia Deluxe Series Sport 6 Silicone Two-Tone Strap')).toBe('null')
  })

  it('matches a model name followed by a DIGIT', () => {
    // ⚠️ `\bgalaxy watch\b` could never match "Galaxy Watch9" — `\b` needs a non-word character
    // and a digit is a word character, so the rule silently did nothing for Samsung's whole
    // current line. Same family as the boundary traps regex-lint exists to catch.
    expect(at('Samsung Galaxy Watch9 40mm Smartwatch')).toBe('electronics/smartwatch')
    expect(at('Samsung Galaxy Watch Ultra2 smartwatch')).toBe('electronics/smartwatch')
  })

  it('reads the appliance a department-only breadcrumb refused to name', () => {
    expect(at('Xiaomi Vacuum X20 Max robot vacuum cleaner and mop')).toBe('furniture-appliances/white-goods')
    expect(at('Xiaomi Air Purifier 4 Lite')).toBe('furniture-appliances/white-goods')
    expect(at('Magic A-253 Floor Fan')).toBe('furniture-appliances/white-goods')
    expect(at('Dyson Supersonic HD08 Hair Dryer')).toBe('fashion-beauty/beauty')
  })

  it('leaves a consumable FOR an appliance alone', () => {
    expect(at('Replacement filter for LG Puricare Aero Booster Pet air purifier')).toBe('null')
  })

  it('says nothing about a product it has no opinion on', () => {
    expect(at('iPhone 16 Pro Max 256GB')).toBe('null')
  })
})

describe('placementFromTitle · things that NAME a device but are not it', () => {
  const at = (title: string, current: any) => {
    const p = placementFromTitle(title, current)
    return p ? `${p.category}/${p.subcategory ?? '—'}` : 'null'
  }
  const svc = { category: 'services', subcategory: null }
  const cam = { category: 'electronics', subcategory: 'cameras' }

  it('never drags a warranty plan out of services by the device it covers', () => {
    // Nine of these would have become smartwatches. A service names its device faithfully, which is
    // exactly why a keyword rule believes it.
    expect(at('Samsung Care+ Package 6 for Samsung Galaxy Watch 7 40mm LTE', svc)).toBe('null')
    expect(at('1-year Samsung Care+ package for Samsung Galaxy Watch 7 44mm', svc)).toBe('null')
  })

  it('leaves a camera dry cabinet in Cameras', () => {
    // The dehumidifier is the FEATURE, not the product.
    expect(at('Nikatei NC-230HS Premium Dehumidifier Cabinet', cam)).toBe('null')
    expect(at('Andbon AD-30S Camera Dehumidifier Cabinet', cam)).toBe('null')
  })

  it('still moves a real humidifier', () => {
    expect(at('Xiaomi Smart Humidifier 2', { category: 'electronics', subcategory: 'accessories' }))
      .toBe('furniture-appliances/white-goods')
  })
})

describe('placementForCrumbs · a sub-aisle inside its own department', () => {
  const place = (path: string) => {
    const p = placementForCrumbs(path.split(' > '))
    return p ? `${p.category}/${p.subcategory ?? '—'}` : '(none)'
  }
  it('files watch bands as accessories, not as watches', () => {
    // ⛔ The strap aisle lives INSIDE the watch aisle: "Đồng hồ thông minh > Dây đồng hồ". The broad
    // rule matches that first crumb, so without the strap rule above it, 35 bands were smartwatches.
    expect(place('Đồng hồ thông minh > Dây đồng hồ')).toBe('electronics/accessories')
    expect(place('Đồng hồ thông minh > Phụ kiện Spigen > Dây đồng hồ')).toBe('electronics/accessories')
    expect(place('Phụ kiện > Phụ Kiện Apple > Phụ kiện Apple Watch')).toBe('electronics/accessories')
  })
  it('still files the watches themselves as watches', () => {
    expect(place('Đồng hồ thông minh > Apple Watch > Đồng hồ Apple Watch Ultra 3')).toBe('electronics/smartwatch')
    expect(place('Đồng hồ thông minh > Đồng hồ thông minh nghe gọi')).toBe('electronics/smartwatch')
  })
})

describe('placementFromTitle · cases three reviewers found in one pass', () => {
  const acc = { category: 'electronics', subcategory: 'accessories' }
  const at = (title: string, cur: any = acc) => {
    const r = placementFromTitle(title, cur)
    return r ? `${r.category}/${r.subcategory ?? '—'}` : 'null'
  }

  it('separates a watch from its band by the CASE MATERIAL, not the noun or the model', () => {
    /**
     * ⛔ Both of these end in "Band", name ONE size, and carry a model word — so noun, size and
     * model are each useless alone. A watch is sold by its case material; a band has no case.
     * ⚠️ An earlier "model marker OR no accessory noun" test passed every band case in this file
     * and was still wrong: those cases happened to have no model word. A band that advertises
     * compatibility has one, which cancelled the guard and would have pulled all 35 bands back.
     */
    expect(at('Apple Watch SE 3 40mm (5G) Aluminum Case Rubber Band')).toBe('electronics/smartwatch')
    expect(at('Apple Watch Series 8 45mm 4G Stainless Steel Case with Rubber Band')).toBe('electronics/smartwatch')
    expect(at('Apple Watch Ultra 49mm Ocean Band')).toBe('null')
    expect(at('Galaxy Watch7 Sport Band 44mm')).toBe('null')
    expect(at('Spigen Rugged Armor for Apple Watch Series 10 46mm')).toBe('null')
    expect(at('Dây đeo Apple Watch Ultra 49mm Ocean Band')).toBe('null')
    expect(at('Apple Watch 46mm Sport Band M/L')).toBe('null')
    expect(at('Otterbox Apple Watch 40/41/42mm Band')).toBe('null')
  })

  it('still recognises a plain watch that mentions no band at all', () => {
    expect(at('Samsung Galaxy Watch9 40mm Smartwatch')).toBe('electronics/smartwatch')
    expect(at('Samsung Galaxy Watch 7 44mm')).toBe('electronics/smartwatch')
  })

  it('runs the accessory guard before EVERY rule, not between them', () => {
    // It used to sit below the watch rule, so it protected appliances and nothing else.
    expect(at('Apple Watch 45mm charging dock')).toBe('null')
  })

  it('does not mistake a cooling fan for a household fan', () => {
    // ⚠️ A bare `\bquạt\b` would haul PC and phone coolers into Home Appliances — and since the
    // title now OVERRIDES the breadcrumb, their perfectly good crumbs would not save them.
    expect(at('Quạt tản nhiệt CPU Corsair iCUE AF120')).toBe('null')
    expect(at('Quạt tản nhiệt sò lạnh điện thoại Black Shark')).toBe('null')
    expect(at('Quạt đứng Senko DH1636')).toBe('furniture-appliances/white-goods')
    // ⚠️ And the same narrowing in the BREADCRUMB rule — a null title verdict falls back to it, so
    // a bare `quạt` there would put a PC cooler in Home Appliances anyway.
    expect(place('Phụ kiện > Quạt tản nhiệt CPU')).toBe('electronics/accessories')
    // ⚠️ And the plain crumb with no type word after it — enumerating fan TYPES broke this one and
    // sent 55 real fans back to the kitchen. Exclude the exception, do not enumerate the rule.
    expect(place('Đồ gia dụng > Quạt')).toBe('furniture-appliances/white-goods')
    expect(place('Đồ gia dụng > Quạt > Quạt đứng')).toBe('furniture-appliances/white-goods')
    expect(at('Magic A-253 Floor Fan')).toBe('furniture-appliances/white-goods')
  })
})

describe('placementForCrumbs · ordering inside the used-stock block', () => {
  it('puts a used washing machine in appliances, not the kitchen', () => {
    // `hàng cũ.*đồ gia dụng` is the DEPARTMENT and reaches the whole path.
    expect(place('Hàng cũ > Đồ gia dụng cũ > Máy giặt')).toBe('furniture-appliances/white-goods')
    expect(place('Hàng cũ > Đồ gia dụng cũ > Nồi cơm điện')).toBe('furniture-appliances/kitchenware')
  })
  it('puts a used watch strap in accessories, not smartwatches', () => {
    expect(place('Hàng cũ > Phụ kiện cũ > Dây đồng hồ')).toBe('electronics/accessories')
    expect(place('Hàng cũ > Đồng hồ thông minh cũ > Xiaomi')).toBe('electronics/smartwatch')
  })
})

/**
 * ⛔ THE FULL DECISION PATH, not either function alone — this is how classify-by-breadcrumb.ts
 * actually decides, and the bugs three reviewers found live in the SEAM between the two.
 *
 * The rule the seam encodes: a specific breadcrumb always wins; only a `vague` one (a DEPARTMENT
 * like "Hàng cũ > Đồ gia dụng cũ", which carries a rice cooker and a robot vacuum alike) may be
 * corrected by the title. An earlier version let the title beat ANY breadcrumb and produced a
 * fresh hole every review round — a band whose name contains "Smartwatch", a tempered-glass
 * protector for a watch, a used iPad sleeve — each one a case where the crumb was already right.
 */
describe('the seam · breadcrumb vs title', () => {
  const decide = (title: string, crumbs: string[]) => {
    const m = matchCrumbs(crumbs)
    const byCrumb = m?.to ?? null
    const place = m && !m.vague
      ? m.to
      : placementFromTitle(title, byCrumb ?? { category: 'electronics', subcategory: 'accessories' }) ?? byCrumb
    return place ? `${place.category}/${place.subcategory ?? '—'}` : 'null'
  }

  it('lets a SPECIFIC breadcrumb overrule a confident-sounding title', () => {
    expect(decide('Smartwatch band for Apple Watch 45mm', ['Đồng hồ thông minh', 'Dây đồng hồ'])).toBe('electronics/accessories')
    expect(decide('Kính cường lực Apple Watch Series 10 46mm', ['Phụ kiện', 'Phụ Kiện Apple', 'Phụ kiện Apple Watch'])).toBe('electronics/accessories')
  })

  it('lets the TITLE correct a department-only breadcrumb', () => {
    // Identical crumbs, opposite answers — only the title can tell these apart.
    expect(decide('Used Xiaomi Vacuum Mop 2 Pro Robot Vacuum Cleaner', ['Hàng cũ', 'Đồ gia dụng cũ'])).toBe('furniture-appliances/white-goods')
    expect(decide('Sunhouse SHD4821 20L Microwave Oven', ['Hàng cũ', 'Đồ gia dụng cũ'])).toBe('furniture-appliances/kitchenware')
  })

  it('files a used accessory as the accessory, not as the device it fits', () => {
    expect(decide('Bao da iPad Pro 11 inch', ['Hàng cũ', 'Phụ kiện cũ', 'Bao da iPad'])).toBe('electronics/phone-cases')
    expect(decide('Sạc Macbook 96W', ['Hàng cũ', 'Phụ kiện cũ', 'Sạc Macbook'])).toBe('electronics/cables-chargers')
    expect(decide('Thẻ nhớ SD 128GB', ['Hàng cũ', 'Phụ kiện cũ', 'Thẻ nhớ máy ảnh'])).toBe('electronics/storage')
  })

  it('still routes the used devices themselves correctly', () => {
    expect(decide('Xiaomi Redmi Watch 4 Smartwatch - Used', ['Hàng cũ', 'Đồng hồ thông minh cũ', 'Xiaomi'])).toBe('electronics/smartwatch')
    expect(decide('Asus Vivobook 15', ['Hàng cũ', 'Laptop cũ', 'Asus cũ'])).toBe('electronics/laptops-pcs')
    expect(decide('Samsung Galaxy S26 Ultra', ['Hàng cũ', 'Samsung cũ', 'Galaxy S cũ'])).toBe('electronics/phones-tablets')
    expect(decide('Sony A7 IV', ['Hàng cũ', 'Máy ảnh cũ', 'Sony'])).toBe('electronics/cameras')
  })
})

describe('the seam · the last two gaps, both measured before fixing', () => {
  const decide = (title: string, crumbs: string[]) => {
    const m = matchCrumbs(crumbs)
    const bc = m?.to ?? null
    const p = m && !m.vague ? m.to : placementFromTitle(title, bc ?? { category: 'electronics', subcategory: 'accessories' }) ?? bc
    return p ? `${p.category}/${p.subcategory ?? '—'}` : 'null'
  }

  it('routes used TVs and monitors, which matched no rule at all', () => {
    /**
     * ⚠️ 66 listings across 10 paths. The new-goods `^tivi` / `^màn hình` rules are ANCHORED, so a
     * "Hàng cũ >" prefix skipped them and these rows silently kept whatever placement they had —
     * invisible in the move table, because "no rule" is not a move.
     */
    expect(decide('LG 27GP850 monitor', ['Hàng cũ', 'Màn hình cũ', 'Màn hình LG cũ'])).toBe('electronics/tv-monitors')
    expect(decide('Smart tivi Samsung 55 inch', ['Hàng cũ', 'Tivi cũ'])).toBe('electronics/tv-monitors')
  })

  it('does not read a screen protector or a cable as the device it fits', () => {
    // A bare "Phụ kiện" crumb is vague, so the title decides — and a tempered-glass protector names
    // its watch as faithfully as a watch does.
    expect(decide('Kính cường lực Apple Watch Series 10 46mm', ['Phụ kiện'])).toBe('electronics/accessories')
    expect(decide('Apple Watch 45mm charging cable', ['Phụ kiện'])).toBe('electronics/accessories')
  })
})

describe('placementFromTitle · Vietnamese accessory nouns and the boundary trap', () => {
  const at = (title: string) => {
    const r = placementFromTitle(title, { category: 'electronics', subcategory: 'accessories' })
    return r ? `${r.category}/${r.subcategory ?? '—'}` : 'null'
  }
  it('recognises ốp / dây da / dây silicone as accessories', () => {
    /**
     * ⛔ `ốp` is anchored on WHITESPACE, never `\b`. I wrote `\bốp\b` and regex-lint failed the
     * build within the minute: `ố` is not a word character to JS, so that boundary can never match
     * and the guard would have been silently off — the ninth instance of this trap in this repo,
     * and the first caught by the linter rather than by a human reading wrong output.
     */
    expect(at('Ốp Apple Watch Series 10 46mm')).toBe('null')
    expect(at('Dây da Apple Watch 45mm')).toBe('null')
  })
  it('sees "for Galaxy Watch7", where a digit follows the model name', () => {
    // Same trailing-`\b` trap, one line above the note that documents it.
    expect(at('Spigen Thin Fit Case for Galaxy Watch7 44mm')).toBe('null')
  })
})

describe('the iron that was a desk', () => {
  it('does not read "bàn làm việc" (desk) as "bàn là" (iron)', () => {
    /**
     * ⛔ "bàn là" is a PREFIX of "bàn làm việc", so the bare token matched
     * "Phụ kiện > Decor - Setup bàn làm việc" and filed 31 desk-setup accessories as home
     * appliances. `\b` cannot fix it — `à` is not a word character to JS — so the token is anchored
     * on whitespace instead, in BOTH the crumb rule and the title list.
     */
    expect(place('Phụ kiện > Decor - Setup bàn làm việc')).toBe('electronics/accessories')
    expect(place('Đồ gia dụng > Bàn là')).toBe('furniture-appliances/white-goods')
    expect(placementFromTitle('Bàn làm việc nâng hạ Xiaomi', { category: 'electronics', subcategory: 'accessories' })).toBeNull()
  })
})
