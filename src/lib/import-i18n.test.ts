import { describe, expect, it } from 'vitest'
import segments from '@/data/import-segment-translations.json'
import { assertCleanTexts } from './publish-guard'
import { fold } from './fold'
import {
  EN_FACT_LABELS, REFERENCE_EN_FACT_LABELS, REFERENCE_VI_LABELS, VI_FACT_LABELS, englishRentValue, localizeImportText,
  localizeReferenceImportText, rebaseSearchText, titleLocation, translateSegment, untranslatedSummary, type ImportTexts,
} from './import-i18n'
import { streetValueProblem } from '../../scripts/verify-nhatot-import'

/**
 * src/lib/import-i18n.ts — the English text of an imported listing is English, the Vietnamese text
 * Vietnamese. The three REAL rows below are what each importer's mapper composed from the 2026-09-24
 * staged files (nhatot:134468299, muaban:71255923, honeycomb:316726) before this change — i.e. what
 * production stores for those rows today.
 */
const NHATOT: ImportTexts = {
  title: 'Apartment · 2 bed · 2 bath · 80 m² for rent — Xã Nhà Bè mới, Huyện Nhà Bè',
  titleVi: 'Cho thuê Căn hộ / Chung cư 2PN 80m² — Xã Nhà Bè mới, Huyện Nhà Bè',
  description: 'Listed on Nhatot.com. eno links to the original — enquiries and viewings are handled there, not by eno.\n\nType: Apartment\nArea: 80 m²\nBedrooms: 2\nBathrooms: 2\nBuilding: Celesta Rise\nStreet: Đường Nguyễn Hữu Thọ\nWard: Xã Nhà Bè\nFormer ward: Xã Phước Kiển\nDistrict: Huyện Nhà Bè\nCity: Ho Chi Minh City\nRent: 13,000,000 đ/month',
  descriptionVi: 'Tin đăng trên Nhatot.com. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.\n\nLoại hình: Chung cư\nDiện tích: 80 m²\nPhòng ngủ: 2\nPhòng vệ sinh: 2\nDự án: Celesta Rise\nĐường: Đường Nguyễn Hữu Thọ\nPhường/xã: Xã Nhà Bè\nPhường cũ: Xã Phước Kiển\nQuận/huyện: Huyện Nhà Bè\nTỉnh/thành: TP. Hồ Chí Minh\nGiá thuê: 13.000.000 đ/tháng',
}
const NHATOT_SEARCH = 'apartment · 2 bed · 2 bath · 80 m² for rent — xa nha be moi, huyen nha be cho thue can ho / chung cu 2pn 80m² — xa nha be moi, huyen nha be huyen nha be (xa nha be moi) huyen nha be chung cu xa phuoc kien celesta rise duong nguyen huu tho tp. ho chi minh ho chi minh city'
const MUABAN: ImportTexts = {
  title: 'Room · 25 m² for rent — Phường 22, Quận Bình Thạnh',
  titleVi: 'Cho thuê Nhà trọ, phòng trọ 25m² — Phường 22, Quận Bình Thạnh',
  description: 'Listed on Muaban.net. eno links to the original — enquiries and viewings are handled there, not by eno.\n\nType: Nhà trọ, phòng trọ\nArea: 25 m²\nLocation: Phường 22, Quận Bình Thạnh, Hồ Chí Minh\nRent: 2.500.000 đ/month',
  descriptionVi: 'Tin đăng trên Muaban.net. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.\n\nLoại hình: Nhà trọ, phòng trọ\nDiện tích: 25 m²\nKhu vực: Phường 22, Quận Bình Thạnh, Hồ Chí Minh\nGiá thuê: 2.500.000 đ/tháng',
}
const MUABAN_SEARCH = 'room · 25 m² for rent — phuong 22, quan binh thanh cho thue nha tro, phong tro 25m² — phuong 22, quan binh thanh phuong 22, quan binh thanh, ho chi minh quan binh thanh nha tro, phong tro room ho chi minh ho chi minh city'
const HONEYCOMB: ImportTexts = {
  title: '2 bed · 2 bath apartment for rent — Palm Heights, An Phu Ward, District 2',
  titleVi: 'Cho thuê căn hộ 2PN — Palm Heights, P. An Phú, Quận 2',
  description: 'Listed on Honeycomb House (honeycomb.com.vn). eno links to the original — enquiries and viewings are handled there, not by eno.\n\nType: Apartment\nProject: Palm Heights\nBedrooms: 2\nBathrooms: 2\nStreet: Song Hanh Street\nLocation: An Phu Ward, District 2, Ho Chi Minh City\nListing code: PH316726\nRent: US$1,154/month\n\nHoneycomb House quotes this rent in US dollars. The đồng price shown on eno is converted from it and is approximate.',
  descriptionVi: 'Tin đăng trên Honeycomb House (honeycomb.com.vn). eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.\n\nLoại: Căn hộ\nDự án: Palm Heights\nPhòng ngủ: 2\nPhòng tắm: 2\nĐường: Song Hanh Street\nKhu vực: P. An Phú, Quận 2, Hồ Chí Minh\nMã tin: PH316726\nGiá thuê: 1.154 USD/tháng\n\nHoneycomb House niêm yết giá thuê bằng USD. Giá VND hiển thị trên eno được quy đổi từ USD và chỉ mang tính tham khảo.',
}

/** The lines of `after` that differ from `before`, as [before, after] pairs. */
const changedLines = (before: string, after: string) => {
  const a = before.split('\n'), b = after.split('\n')
  expect(b.length).toBe(a.length)   // a line is replaced, never added or removed
  return a.flatMap((l, i) => (l === b[i] ? [] : [[l, b[i]]]))
}
const strip = (t: ReturnType<typeof localizeImportText>) => ({ title: t.title, titleVi: t.titleVi, description: t.description, descriptionVi: t.descriptionVi })

describe('the reviewed dictionary (src/data/import-segment-translations.json)', () => {
  const all = (['en', 'vi'] as const).flatMap((t) => Object.entries(segments[t] as Record<string, string>).map(([src, tr]) => ({ t, src, tr })))

  it('is the reviewed set: 1,866 English and 9 Vietnamese segments, every key and value NFC', () => {
    // Part 1: 1,284 + 8. Part 3 (2026-09-24) ADDED 581 + 1 reviewed entries (Batdongsan / Rever and a
    // second extraction) without replacing a committed value, plus ONE by hand: "Nam" → "South" (the
    // header of import-i18n.ts says why).
    expect(Object.keys(segments.en)).toHaveLength(1866)
    expect(Object.keys(segments.vi)).toHaveLength(9)
    for (const { src, tr } of all) {
      expect(src, src).toBe(src.normalize('NFC'))
      expect(tr, src).toBe(tr.normalize('NFC'))
      expect(tr.trim(), src).toBe(tr)
      expect(tr, src).not.toBe('')
    }
  })

  it('⛔ has no chains — a translation is never a key with a DIFFERENT translation (that is what makes it idempotent)', () => {
    for (const { t, tr } of all) {
      const again = translateSegment(t, tr)
      expect(again === undefined || again === tr, `${t}: ${tr} → ${again}`).toBe(true)
    }
  })

  it('⛔ no translation carries the Icelandic Eth (Ð U+00D0) for Vietnamese Đ (U+0110), and street names are cased', () => {
    // Keys keep whatever the SOURCE typed (they must match it); the published translation may not.
    // Four streets carried 'Ðề Thám' / 'Trần Ðình Xu' … into English (agy + codex, 2026-09-24) while
    // the translators had already fixed three siblings ('Đinh Công Tráng').
    for (const { src, tr } of all) expect(/[Ðð]/.test(tr), `${src} → ${tr}`).toBe(false)
    for (const { src, tr } of all.filter(({ tr }) => / (?:Street|Road)$/.test(tr))) {
      expect(/^[\p{Lu}\d]/u.test(tr), `${src} → ${tr}`).toBe(true)
      expect(tr.split(' ').some((w) => w.length > 3 && w === w.toUpperCase() && /\p{Lu}/u.test(w)), `${src} → ${tr}`).toBe(false)
    }
    expect(translateSegment('en', 'Đường Ðề Thám')).toBe('Đề Thám Street')
    expect(translateSegment('en', 'hồ trọng quý')).toBe('Hồ Trọng Quý Street')
    // …and the key matches whichever D the source typed: the Eth the reviewed key holds, or the real Đ.
    expect(translateSegment('en', 'Đường Đề Thám')).toBe('Đề Thám Street')
    expect(translateSegment('en', 'Đường Đinh Công Tráng')).toBe('Đinh Công Tráng Street')
    // Reading Ð as Đ may merge two keys only when they agree (today: 'Đường Điện Biên Phủ', both ways).
    const seen = new Map<string, string>()
    for (const { t, src, tr } of all) {
      const k = `${t}:${src.replace(/Ð/g, 'Đ')}`
      expect(seen.get(k) ?? tr, `${src} → ${tr} vs ${seen.get(k)}`).toBe(tr)
      seen.set(k, tr)
    }
  })

  it('keeps every number of the source (a door, a ward number, a route)', () => {
    const nums = (s: string) => (s.match(/\d+/g) ?? []).sort().join(',')
    for (const { src, tr } of all) expect(nums(tr), `${src} → ${tr}`).toBe(nums(src))
  })

  it('⛔ every translation passes the publish guard’s text screen (phone, contact, link, banned word)', () => {
    for (const { src, tr } of all) expect(() => assertCleanTexts([tr]), `${src} → ${tr}`).not.toThrow()
  })

  it('every translated street passes the INDEPENDENT door check of scripts/verify-nhatot-import.ts', () => {
    // A translation with a comma is a whole ADDRESS (Rever's "Address:" line), not a street value — the
    // door check is for the Street line. Those two are pinned in the Address test below.
    const streets = all.filter(({ t, tr }) => t === 'en' && !tr.includes(',') && /(?:^Street\b|\b(?:Street|Road)$|^(?:National Route|Provincial Road)\b)/.test(tr))
    expect(streets.length).toBeGreaterThan(400)
    for (const { src, tr } of streets) expect(streetValueProblem(tr), `${src} → ${tr}`).toBeNull()
    // …and the new English numbered shapes are still whole-value only: a name after the number is a door.
    for (const door of ['Street No. 12 Lê Lợi', 'Street 12 Lê Lợi', 'National Route 13 số 250', 'Lê Lợi Street 102']) {
      expect(streetValueProblem(door), door).not.toBeNull()
    }
  })
})

describe('localizeImportText — the three real rows', () => {
  it('nhatot: the English title and the Street / Ward / Former ward / District lines become English; Vietnamese untouched', () => {
    const out = localizeImportText(NHATOT)
    expect(out.title).toBe('Apartment · 2 bed · 2 bath · 80 m² for rent — Nhà Bè Commune (new), Nhà Bè District')
    expect(changedLines(NHATOT.description, out.description)).toEqual([
      ['Street: Đường Nguyễn Hữu Thọ', 'Street: Nguyễn Hữu Thọ Street'],
      ['Ward: Xã Nhà Bè', 'Ward: Nhà Bè Commune'],
      ['Former ward: Xã Phước Kiển', 'Former ward: Phước Kiển Commune'],
      ['District: Huyện Nhà Bè', 'District: Nhà Bè District'],
    ])
    // The Building line ("Celesta Rise") has no entry and is not Vietnamese: untouched, not reported.
    expect(out.titleVi).toBe(NHATOT.titleVi)
    expect(out.descriptionVi).toBe(NHATOT.descriptionVi)
    expect(out.missing).toEqual([])
  })

  it('muaban: the title, Type and Location become English, and the rent gets English commas', () => {
    const out = localizeImportText(MUABAN)
    expect(out.title).toBe('Room · 25 m² for rent — Ward 22, Bình Thạnh District')
    expect(changedLines(MUABAN.description, out.description)).toEqual([
      ['Type: Nhà trọ, phòng trọ', 'Type: Boarding room'],
      ['Location: Phường 22, Quận Bình Thạnh, Hồ Chí Minh', 'Location: Ward 22, Bình Thạnh District, Ho Chi Minh City'],
      ['Rent: 2.500.000 đ/month', 'Rent: 2,500,000 đ/month'],
    ])
    // ⛔ The Vietnamese rent keeps its dots — that IS the Vietnamese format.
    expect(out.descriptionVi).toBe(MUABAN.descriptionVi)
    expect(out.titleVi).toBe(MUABAN.titleVi)
  })

  it('honeycomb: the Vietnamese street becomes Vietnamese; the English text (and its US$ rent) is untouched', () => {
    const out = localizeImportText(HONEYCOMB)
    expect(out.title).toBe(HONEYCOMB.title)
    expect(out.description).toBe(HONEYCOMB.description)
    expect(changedLines(HONEYCOMB.descriptionVi, out.descriptionVi)).toEqual([['Đường: Song Hanh Street', 'Đường: Đường Song Hành']])
    expect(out.titleVi).toBe(HONEYCOMB.titleVi)
    expect(out.missing).toEqual([])
  })

  it('is idempotent: a second pass changes nothing, on every real row', () => {
    for (const row of [NHATOT, MUABAN, HONEYCOMB]) {
      const once = strip(localizeImportText(row))
      const twice = localizeImportText(once)
      expect(strip(twice)).toEqual(once)
      expect(twice.missing).toEqual([])
    }
  })

  it('is idempotent on every dictionary entry, in a title and on a fact line', () => {
    for (const [src] of Object.entries(segments.en as Record<string, string>)) {
      const once = strip(localizeImportText({ title: `Room for rent — ${src}`, titleVi: 'x', description: `Location: ${src}\nStreet: ${src}`, descriptionVi: 'x' }))
      expect(strip(localizeImportText(once)), src).toEqual(once)
      const ref = strip(localizeReferenceImportText({
        title: `Room for rent — ${src}`, titleVi: `Cho thuê — ${src}`,
        description: `Type: ${src}\nLocation: ${src}\nAddress: ${src}\nDirection: ${src}`, descriptionVi: `Type: ${src}\nAddress: ${src}\nRent: 1.000.000 đ/month`,
      }))
      expect(strip(localizeReferenceImportText(ref)), src).toEqual(ref)
    }
  })
})

describe('localizeImportText — the contract', () => {
  it('NFD input is looked up by its NFC form, and the replacement is NFC', () => {
    const nfd = { ...MUABAN, title: MUABAN.title.normalize('NFD'), description: MUABAN.description.normalize('NFD') }
    expect(nfd.title).not.toBe(MUABAN.title)
    const out = localizeImportText(nfd)
    expect(out.title.endsWith('— Ward 22, Bình Thạnh District')).toBe(true)
    expect(out.description).toContain('\nLocation: Ward 22, Bình Thạnh District, Ho Chi Minh City\n')
    expect(out.description).toContain('\nType: Boarding room\n')
    // VI side: an NFD label ("Đường" decomposes) still matches the label allowlist.
    const vi = localizeImportText({ ...HONEYCOMB, descriptionVi: HONEYCOMB.descriptionVi.normalize('NFD') })
    expect(vi.descriptionVi).toContain('\nĐường: Đường Song Hành\n')
  })

  it('⛔ a line with no dictionary entry is returned byte for byte — NFD included', () => {
    const line = 'Street: Đường Chưa Có Trong Từ Điển'.normalize('NFD')
    const title = 'Room for rent — P. Chưa Có mới, Quận 99'.normalize('NFD')
    const out = localizeImportText({ title, titleVi: 'Cho thuê', description: `Intro.\n\n${line}\nArea: 25 m²`, descriptionVi: 'x' })
    expect(out.title).toBe(title)
    expect(out.description).toBe(`Intro.\n\n${line}\nArea: 25 m²`)
    // …and it is REPORTED, in the dictionary's own item shape, NFC.
    expect(out.missing).toEqual([
      { target: 'en', kind: 'title-location', src: 'P. Chưa Có mới, Quận 99' },
      { target: 'en', kind: 'desc:Street', src: 'Đường Chưa Có Trong Từ Điển' },
    ])
  })

  it('⛔ only the labels the dictionary was cut from are looked up — "Project: An Phú" is a name, not a street', () => {
    expect(translateSegment('en', 'An Phú')).toBe('An Phú Street')
    const out = localizeImportText({ title: 'x', titleVi: 'x', description: 'Project: An Phú\nStreet: An Phú\nListing code: An Phú', descriptionVi: 'Dự án: Song Hanh Street' })
    expect(out.description).toBe('Project: An Phú\nStreet: An Phú Street\nListing code: An Phú')
    expect(out.descriptionVi).toBe('Dự án: Song Hanh Street')
    expect(EN_FACT_LABELS).toEqual(['Type', 'Facing', 'Street', 'Ward', 'Former ward', 'District', 'Building', 'Location'])
    expect(VI_FACT_LABELS).toEqual(['Đường'])
  })

  it('⛔ a street entry is used on the street line ONLY — a bare street name is also a ward name', () => {
    // The six bare street keys that are also ward names (measured on the reviewed set).
    for (const name of ['An Phú', 'Phú Hữu', 'Bình Hưng', 'Hòa Bình', 'Tân Hưng', 'Tân Sơn Nhì']) {
      expect(translateSegment('en', name), name).toBe(`${name} Street`)
      const out = localizeImportText({
        title: `Room for rent — ${name}`, titleVi: 'x',
        description: `Street: ${name}\nWard: ${name}\nFormer ward: ${name}\nBuilding: ${name}\nLocation: ${name}\nDistrict: ${name}`,
        descriptionVi: 'x',
      })
      expect(out.title, name).toBe(`Room for rent — ${name}`)
      expect(out.description, name).toBe(`Street: ${name} Street\nWard: ${name}\nFormer ward: ${name}\nBuilding: ${name}\nLocation: ${name}\nDistrict: ${name}`)
      // Left alone AND reported: each of those lines needs its own reviewed entry.
      expect(out.missing.map((m) => m.kind), name).toEqual(['title-location', 'desc:Ward', 'desc:Former ward', 'desc:Building', 'desc:Location', 'desc:District'])
    }
    // Vietnamese: a street entry is for the "Đường:" line, never a title.
    const vi = localizeImportText({ title: 'x', titleVi: 'Cho thuê — Song Hanh Street', description: 'x', descriptionVi: 'Đường: Song Hanh Street\nKhu vực: Song Hanh Street' })
    expect(vi.titleVi).toBe('Cho thuê — Song Hanh Street')
    expect(vi.descriptionVi).toBe('Đường: Đường Song Hành\nKhu vực: Song Hanh Street')
  })

  it('a compass entry is used on the Facing line only — "Đông Nam" may be a building’s name', () => {
    expect(translateSegment('en', 'Đông Nam')).toBe('Southeast')
    const out = localizeImportText({ title: 'Room for rent — Đông Nam', titleVi: 'x', description: 'Facing: Đông Nam\nBuilding: Đông Nam\nStreet: Bắc\nType: Tây', descriptionVi: 'x' })
    expect(out.title).toBe('Room for rent — Đông Nam')
    expect(out.description).toBe('Facing: Southeast\nBuilding: Đông Nam\nStreet: Bắc\nType: Tây')
  })

  it('⛔ the English numbered-street shapes the verifier now accepts only ever translate the Vietnamese numbered shape of the SAME number', () => {
    // So the verifier's new rows admit nothing the importer's own sanitiser (nhatotStreetName's
    // NUMBERED_STREET) did not already admit as a numbered NAME — never a door ("Số 11" is not here).
    const shapes: [RegExp, (n: string) => RegExp][] = [
      [/^Street No\. (\d{1,3}[A-Z]?)$/, (n) => new RegExp(`^đường\\s+số\\s+${n}$`, 'iu')],
      [/^Street (\d{1,3}[A-Z]?)$/, (n) => new RegExp(`^đường\\s+${n}$`, 'iu')],
      [/^National Route (\d{1,3}[A-Z]?)$/, (n) => new RegExp(`^(?:đường\\s+)?quốc\\s+lộ\\s*${n}$`, 'iu')],
      [/^Provincial Road (\d{1,3}[A-Z]?)$/, (n) => new RegExp(`^(?:đường\\s+)?tỉnh\\s+lộ\\s*${n}$`, 'iu')],
      [/^Hương Lộ (\d{1,3}[A-Z]?) Road$/, (n) => new RegExp(`^(?:đường\\s+)?hương\\s+lộ\\s*${n}$`, 'iu')],
    ]
    let seen = 0
    for (const [src, tr] of Object.entries(segments.en as Record<string, string>)) {
      for (const [re, from] of shapes) {
        const m = re.exec(tr)
        if (!m) continue
        seen++
        expect(from(m[1]).test(src), `${src} → ${tr}`).toBe(true)
      }
    }
    expect(seen).toBeGreaterThan(60)
  })

  it('the street scope is read from the translation’s shape, and catches every street-shaped entry', () => {
    const shaped = Object.entries(segments.en as Record<string, string>).filter(([, tr]) => !tr.includes(',') && /(?:^Street\s| (?:Street|Road)$|^(?:National Route|Provincial Road)\s)/.test(tr))
    expect(shaped.length).toBeGreaterThan(500)
    for (const [src, tr] of shaped) {
      expect(translateSegment('en', src, 'Street'), src).toBe(tr)
      for (const slot of ['title', 'Ward', 'Former ward', 'District', 'Building', 'Location', 'Type', 'Facing', 'Address', 'Direction']) expect(translateSegment('en', src, slot), `${slot}: ${src}`).toBeUndefined()
    }
    // A Type that merely starts with the word is not a street, and a street entry that names its own
    // kind (a bridge, an area) is not street-shaped — both apply where they are found.
    expect(translateSegment('en', 'Nhà mặt tiền', 'Type')).toBe('Street-front house')
    expect(translateSegment('en', 'Cầu Him Lam', 'Street')).toBe('Him Lam Bridge')
    expect(localizeImportText({ title: 'x', titleVi: 'x', description: 'Street: Cầu Him Lam', descriptionVi: 'x' }).description).toBe('Street: Him Lam Bridge')
  })

  it('reports a segment once whether it arrives NFC or NFD, and catches Vietnamese typed without marks', () => {
    const src = 'Đường Chưa Có'
    const out = localizeImportText({ title: 'x', titleVi: 'x', description: `Street: ${src}\nStreet: ${src.normalize('NFD')}`, descriptionVi: 'x' })
    expect(out.missing).toEqual([{ target: 'en', kind: 'desc:Street', src }])
    // NFD with no 'Đ' is ASCII letters plus combining marks — still Vietnamese, still reported.
    const nfdOnly = 'Lê Văn Chưa Dịch'.normalize('NFD')
    expect(/[^\u0000-\u007F]/.test(nfdOnly.replace(/\p{M}/gu, ''))).toBe(false)
    expect(localizeImportText({ title: 'x', titleVi: 'x', description: `Street: ${nfdOnly}`, descriptionVi: 'x' }).missing)
      .toEqual([{ target: 'en', kind: 'desc:Street', src: 'Lê Văn Chưa Dịch' }])
    const unmarked = localizeImportText({
      title: 'Room for rent — Phuong 22, Quan Binh Thanh', titleVi: 'x',
      description: 'Location: Phuong 22, Quan Binh Thanh, Ho Chi Minh\nStreet: Duong so 12\nStreet: Hoang Hoa Tham Street\nLocation: An Phu Ward, District 2, Ho Chi Minh City',
      descriptionVi: 'x',
    })
    expect(unmarked.missing).toEqual([
      { target: 'en', kind: 'title-location', src: 'Phuong 22, Quan Binh Thanh' },
      { target: 'en', kind: 'desc:Location', src: 'Phuong 22, Quan Binh Thanh, Ho Chi Minh' },
      { target: 'en', kind: 'desc:Street', src: 'Duong so 12' },
    ])
  })

  it('⛔ the rent rule touches ONLY an English "Rent:" line, and only a Vietnamese-grouped number on it', () => {
    const description = [
      'Rent: 2.500.000 đ/month',
      'Rent: US$2,692/month',
      'Rent: 25,000,000 đ/month',
      'Area: 44.500 m²',
      'Floors: 1.000',
    ].join('\n')
    const titleVi = 'Cho thuê — Giá 2.500.000 đ'
    const out = localizeImportText({ title: 'Room · 2.500.000 đ for rent — x', titleVi, description, descriptionVi: 'Giá thuê: 2.500.000 đ/tháng\nRent: 2.500.000 đ/month' })
    expect(out.description.split('\n')).toEqual([
      'Rent: 2,500,000 đ/month',
      'Rent: US$2,692/month',
      'Rent: 25,000,000 đ/month',
      'Area: 44.500 m²',
      'Floors: 1.000',
    ])
    expect(out.title).toBe('Room · 2.500.000 đ for rent — x')
    expect(out.titleVi).toBe(titleVi)
    // A "Rent:" line inside the VIETNAMESE text is not an English line.
    expect(out.descriptionVi).toBe('Giá thuê: 2.500.000 đ/tháng\nRent: 2.500.000 đ/month')
  })

  it('englishRentValue: dotted thousands only — never a decimal, a comma group or a Vietnamese decimal', () => {
    expect(englishRentValue('2.500.000 đ/month')).toBe('2,500,000 đ/month')
    expect(englishRentValue('950.000 đ/month')).toBe('950,000 đ/month')
    expect(englishRentValue('1.250.000.000 đ/month')).toBe('1,250,000,000 đ/month')
    expect(englishRentValue('US$1,154/month')).toBe('US$1,154/month')
    expect(englishRentValue('US$12.5/month')).toBe('US$12.5/month')
    expect(englishRentValue('2.500.000,5 đ/month')).toBe('2.500.000,5 đ/month')
    expect(englishRentValue('1,234.567')).toBe('1,234.567')
    expect(englishRentValue(englishRentValue('2.500.000 đ/month'))).toBe('2,500,000 đ/month')
  })

  it('a stored row with no Vietnamese text keeps null, and a title with no " — " is left alone', () => {
    const out = localizeImportText({ title: 'Apartment for rent', titleVi: null, description: 'Rent: 2.500.000 đ/month', descriptionVi: null })
    expect(out).toEqual({ title: 'Apartment for rent', titleVi: null, description: 'Rent: 2,500,000 đ/month', descriptionVi: null, missing: [] })
  })

  it('reports Vietnamese left in English, and English left in Vietnamese — never a translation, never plain English', () => {
    const out = localizeImportText({
      title: 'Room for rent — Nhà Bè Commune (new), Nhà Bè District',    // a translation: not missing
      titleVi: 'Cho thuê — Thao Dien Ward, District 2',                    // English left in Vietnamese
      description: 'Street: Hoang Hoa Tham Street\nFacing: Hướng Mới\nFacing: Hướng Mới',   // plain English; a duplicate
      descriptionVi: 'Đường: Pham Van Dong Highway\nĐường: Nguyễn Văn Linh',
    })
    expect(out.missing).toEqual([
      { target: 'en', kind: 'desc:Facing', src: 'Hướng Mới' },
      { target: 'vi', kind: 'titleVi-location', src: 'Thao Dien Ward, District 2' },
      { target: 'vi', kind: 'descVi:Đường', src: 'Pham Van Dong Highway' },
    ])
    // "Hanoi Highway" was this test's untranslated example until part 3 reviewed it.
    expect(localizeImportText({ title: 'x', titleVi: 'x', description: 'x', descriptionVi: 'Đường: Hanoi Highway' }).descriptionVi).toBe('Đường: Xa lộ Hà Nội')
  })

  it('leaves our own prose alone: the intro has no fact label, and an unlisted label is never looked up', () => {
    const intro = 'Listed on Muaban.net. eno links to the original — enquiries and viewings are handled there, not by eno.'
    const description = `${intro}\n\nNote: Phường 22, Quận Bình Thạnh\nFacing: Bắc`
    const out = localizeImportText({ title: intro, titleVi: 'x', description, descriptionVi: 'x' })
    expect(out.title).toBe(intro)
    expect(out.description).toBe(`${intro}\n\nNote: Phường 22, Quận Bình Thạnh\nFacing: North`)
    expect(out.missing).toEqual([])
  })
})

describe('rebaseSearchText — the searchText a stored row carries once its titles are English', () => {
  it('swaps the folded title head, which is exactly what the importer now composes', () => {
    const out = localizeImportText(NHATOT)
    const next = rebaseSearchText(NHATOT_SEARCH, NHATOT, out)
    expect(next.startsWith(fold(`${out.title} ${out.titleVi}`) + ' ')).toBe(true)
    expect(next.endsWith(NHATOT_SEARCH.slice(fold(`${NHATOT.title} ${NHATOT.titleVi}`).length))).toBe(true)
    expect(next).toContain('nha be district')
    const m = localizeImportText(MUABAN)
    expect(rebaseSearchText(MUABAN_SEARCH, MUABAN, m)).toContain('ward 22, binh thanh district')
  })

  it('a searchText composed some other way keeps everything and gains the English title location once', () => {
    const out = localizeImportText(MUABAN)
    const other = 'phuong 22 quan binh thanh legacy blob'
    const once = rebaseSearchText(other, MUABAN, out)
    expect(once).toBe(`${other} ward 22, binh thanh district`)
    expect(rebaseSearchText(once, MUABAN, out)).toBe(once)
  })

  it('changes nothing when the titles did not change (honeycomb English, an already-localized row)', () => {
    expect(rebaseSearchText('anything at all', HONEYCOMB, localizeImportText(HONEYCOMB))).toBe('anything at all')
    const done = localizeImportText(NHATOT)
    const s = rebaseSearchText(NHATOT_SEARCH, NHATOT, done)
    expect(rebaseSearchText(s, done, localizeImportText(done))).toBe(s)
  })

  it('titleLocation is the part after " — "', () => {
    expect(titleLocation(MUABAN.title)).toBe('Phường 22, Quận Bình Thạnh')
    expect(titleLocation('Apartment for rent')).toBeNull()
  })
})

describe('untranslatedSummary — the importers’ dry-run coverage line', () => {
  it('is empty with nothing missing, and counts distinct segments by kind otherwise', () => {
    expect(untranslatedSummary([])).toBe('')
    const line = untranslatedSummary([
      { target: 'en', kind: 'desc:Street', src: 'A' }, { target: 'en', kind: 'desc:Street', src: 'A' },
      { target: 'en', kind: 'desc:Street', src: 'B' }, { target: 'vi', kind: 'descVi:Đường', src: 'C Street' },
    ])
    expect(line).toMatch(/^3 distinct \(en desc:Street 2, vi descVi:Đường 1\) e\.g\. "A" ×2/)
  })
})

/**
 * localizeReferenceImportText — the Batdongsan / Rever template: one fact block with the SAME English
 * labels in both descriptions. Two REAL rows, composed by the importers' compose() before part 3 from
 * the 2026-09-21 source files (batdongsan pr46310931, rever 1654850630130_5651).
 */
const BDS_INTRO_EN = 'Listed on Batdongsan.com.vn. eno links to the original — enquiries and viewings are handled there, not by eno.'
const BDS_INTRO_VI = 'Tin đăng trên Batdongsan.com.vn. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.'
const BDS_FACTS = 'Type: Nhà trọ / Phòng trọ\nArea: 24 m²\nBedrooms: 1\nBathrooms: 1\nLocation: Quận 11 (P. Hòa Bình mới)\nRent: 6.300.000 đ/month'
const BATDONGSAN: ImportTexts = {
  title: '1 bed · 1 bath · 24 m² for rent — P. Hòa Bình mới, Quận 11',
  titleVi: 'Cho thuê Nhà trọ / Phòng trọ 1PN 24m² — P. Hòa Bình mới, Quận 11',
  description: `${BDS_INTRO_EN}\n\n${BDS_FACTS}`,
  descriptionVi: `${BDS_INTRO_VI}\n\n${BDS_FACTS}`,
}
const REVER_INTRO_EN = 'Listed on Rever.vn. eno links to the original — enquiries and viewings are handled by Rever, not by eno.'
const REVER_INTRO_VI = 'Tin đăng trên Rever.vn. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do Rever xử lý, không qua eno.'
const REVER_FACTS = 'Type: Căn hộ / Chung cư\nArea: 60 m²\nBedrooms: 2\nBathrooms: 2\nDirection: Tây Nam\nAddress: Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh\nRent: 10.000.000 đ/month'
const REVER: ImportTexts = {
  title: '2 bed · 2 bath · 60 m² for rent — Thạnh Mỹ Lợi, Quận 2',
  titleVi: 'Cho thuê Căn hộ / Chung cư 2PN 60m² — Thạnh Mỹ Lợi, Quận 2',
  description: `${REVER_INTRO_EN}\n\n${REVER_FACTS}`,
  descriptionVi: `${REVER_INTRO_VI}\n\n${REVER_FACTS}`,
}

describe('localizeReferenceImportText — the Batdongsan / Rever template', () => {
  it('batdongsan: English title, Type, Location and rent; Vietnamese labels and "đ/tháng"; Vietnamese values untouched', () => {
    const out = localizeReferenceImportText(BATDONGSAN)
    expect(out.title).toBe('1 bed · 1 bath · 24 m² for rent — Hòa Bình Ward (new), District 11')
    expect(changedLines(BATDONGSAN.description, out.description)).toEqual([
      ['Type: Nhà trọ / Phòng trọ', 'Type: Boarding room'],
      ['Location: Quận 11 (P. Hòa Bình mới)', 'Location: District 11 (Hòa Bình Ward, new)'],
      ['Rent: 6.300.000 đ/month', 'Rent: 6,300,000 đ/month'],
    ])
    expect(out.descriptionVi).toBe(`${BDS_INTRO_VI}\n\nLoại hình: Nhà trọ / Phòng trọ\nDiện tích: 24 m²\nPhòng ngủ: 1\nPhòng vệ sinh: 1\nKhu vực: Quận 11 (P. Hòa Bình mới)\nGiá thuê: 6.300.000 đ/tháng`)
    expect(out.titleVi).toBe(BATDONGSAN.titleVi)
    expect(out.missing).toEqual([])
  })

  it('rever: the Address and the compass Direction become English; the Vietnamese block keeps "Tây Nam" and the address', () => {
    const out = localizeReferenceImportText(REVER)
    expect(out.title).toBe('2 bed · 2 bath · 60 m² for rent — Thạnh Mỹ Lợi, District 2')
    expect(changedLines(REVER.description, out.description)).toEqual([
      ['Type: Căn hộ / Chung cư', 'Type: Apartment'],
      ['Direction: Tây Nam', 'Direction: Southwest'],
      ['Address: Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh', 'Address: Đồng Văn Cống Street, Thạnh Mỹ Lợi, District 2, Ho Chi Minh City'],
      ['Rent: 10.000.000 đ/month', 'Rent: 10,000,000 đ/month'],
    ])
    expect(changedLines(REVER.descriptionVi, out.descriptionVi)).toEqual([
      ['Type: Căn hộ / Chung cư', 'Loại hình: Căn hộ / Chung cư'],
      ['Area: 60 m²', 'Diện tích: 60 m²'],
      ['Bedrooms: 2', 'Phòng ngủ: 2'],
      ['Bathrooms: 2', 'Phòng vệ sinh: 2'],
      ['Direction: Tây Nam', 'Hướng: Tây Nam'],
      ['Address: Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh', 'Địa chỉ: Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh'],
      ['Rent: 10.000.000 đ/month', 'Giá thuê: 10.000.000 đ/tháng'],
    ])
    expect(out.missing).toEqual([])
  })

  it('is idempotent, and a stored row with no Vietnamese text keeps null', () => {
    for (const row of [BATDONGSAN, REVER]) {
      const once = strip(localizeReferenceImportText(row))
      const twice = localizeReferenceImportText(once)
      expect(strip(twice)).toEqual(once)
      expect(twice.missing).toEqual([])
    }
    const nul = localizeReferenceImportText({ ...BATDONGSAN, titleVi: null, descriptionVi: null })
    expect(nul.titleVi).toBeNull()
    expect(nul.descriptionVi).toBeNull()
  })

  it('the label sets are fixed: four looked-up English labels, eight mapped Vietnamese ones', () => {
    expect(REFERENCE_EN_FACT_LABELS).toEqual(['Type', 'Location', 'Address', 'Direction'])
    expect(REFERENCE_VI_LABELS).toEqual({
      Type: 'Loại hình', Area: 'Diện tích', Bedrooms: 'Phòng ngủ', Bathrooms: 'Phòng vệ sinh',
      Location: 'Khu vực', Address: 'Địa chỉ', Rent: 'Giá thuê', Direction: 'Hướng',
    })
  })

  it('⛔ Vietnamese: only a whole, exact label is mapped; "đ/month" changes on the Rent line only; the intro is prose', () => {
    const descriptionVi = [
      REVER_INTRO_VI, '',
      'Rent: 10.000.000 đ/month',
      'Area: 12 đ/month',                        // not the Rent line: the value is left as it is
      'Rent: US$1,154/month',                    // no "đ/month" — the label maps, the value stays
      'rent: 1 đ/month', 'Rent 1 đ/month', 'Floors: 3', 'constructor: x', 'toString: y',
    ].join('\n')
    const out = localizeReferenceImportText({ title: 'x', titleVi: 'x', description: 'x', descriptionVi })
    expect(out.descriptionVi!.split('\n')).toEqual([
      REVER_INTRO_VI, '',
      'Giá thuê: 10.000.000 đ/tháng',
      'Diện tích: 12 đ/month',
      'Giá thuê: US$1,154/month',
      'rent: 1 đ/month', 'Rent 1 đ/month', 'Floors: 3', 'constructor: x', 'toString: y',
    ])
  })

  it('⛔ English: only Type / Location / Address / Direction are looked up — never Ward, Street or a label of the other template', () => {
    // 'An Phú' is a STREET entry ("An Phú Street") and a ward name: never used off the street line.
    const out = localizeReferenceImportText({
      title: 'x', titleVi: 'x', descriptionVi: 'x',
      description: 'Ward: Phường 22\nStreet: An Phú\nAddress: An Phú\nLocation: An Phú\nDistrict: Quận 4\nFacing: Đông Nam',
    })
    expect(out.description).toBe('Ward: Phường 22\nStreet: An Phú\nAddress: An Phú\nLocation: An Phú\nDistrict: Quận 4\nFacing: Đông Nam')
    expect(out.missing.map((m) => m.kind)).toEqual(['desc:Address', 'desc:Location'])
    // …while the other template does look up its own labels and ignores this one's.
    expect(localizeImportText({ title: 'x', titleVi: 'x', descriptionVi: 'x', description: 'District: Quận 4\nAddress: Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh' }).description)
      .toBe('District: District 4\nAddress: Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh')
  })

  it('⛔ Direction takes a COMPASS entry only, and reports anything that is not a compass point — "Nam" is ASCII', () => {
    expect(translateSegment('en', 'Nam', 'Direction')).toBe('South')
    expect(translateSegment('en', 'Nam', 'Facing')).toBe('South')
    expect(translateSegment('en', 'Nam', 'Location')).toBeUndefined()
    expect(translateSegment('en', 'Nam', 'title')).toBeUndefined()
    // A non-compass entry ("Nhà trọ / Phòng trọ" is a Type; "Quận 4" a district) is refused on Direction.
    expect(translateSegment('en', 'Nhà trọ / Phòng trọ', 'Direction')).toBeUndefined()
    const out = localizeReferenceImportText({ title: 'x', titleVi: 'x', descriptionVi: 'x', description: 'Direction: Nam\nDirection: Quận 4\nDirection: Dong Nam\nDirection: South' })
    expect(out.description).toBe('Direction: South\nDirection: Quận 4\nDirection: Dong Nam\nDirection: South')
    expect(out.missing).toEqual([
      { target: 'en', kind: 'desc:Direction', src: 'Quận 4' },
      { target: 'en', kind: 'desc:Direction', src: 'Dong Nam' },
    ])
  })

  it('an Address translation that starts like a numbered street is a whole address: it applies on its line, and a street never does', () => {
    const comma = Object.entries(segments.en as Record<string, string>).filter(([, tr]) => tr.includes(',') && /^Street\s/.test(tr))
    expect(comma.map(([src]) => src)).toEqual(['Số 104-BTT, Bình Trưng Tây, Quận 2, Hồ Chí Minh', 'Số 11, Thảo Điền, Quận 2, Hồ Chí Minh'])
    for (const [src, tr] of comma) {
      expect(tr).toMatch(/, District 2, Ho Chi Minh City$/)
      expect(translateSegment('en', src, 'Address'), src).toBe(tr)
      expect(localizeReferenceImportText({ title: 'x', titleVi: 'x', descriptionVi: 'x', description: `Address: ${src}` }).description).toBe(`Address: ${tr}`)
    }
    // Every OTHER street-shaped translation is one part — so "no comma" is what separates a street
    // from an address, measured on the whole file (import-i18n.ts isStreetEntry).
    const shaped = Object.entries(segments.en as Record<string, string>)
      .filter(([, tr]) => /(?:^Street\s|\s(?:Street|Road|Avenue|Boulevard|Highway|Alley|Lane)$|^(?:National Route|Provincial Road|Provincial Route)\s)/.test(tr))
    expect(shaped.length).toBeGreaterThan(700)
    expect(shaped.filter(([, tr]) => tr.includes(','))).toEqual(comma)
  })

  it('reports what the dictionary lacks — an unknown address, a title location, a Type — and changes none of it', () => {
    const t: ImportTexts = {
      title: '2 bed for rent — Bến Nghé, Quận 1', titleVi: 'Cho thuê — Bến Nghé, Quận 1',
      description: 'Type: Đất nền\nAddress: Tôn Đức Thắng, Bến Nghé, Quận 1, Hồ Chí Minh\nRent: 5.000.000 đ/month',
      descriptionVi: 'Type: Đất nền\nAddress: Tôn Đức Thắng, Bến Nghé, Quận 1, Hồ Chí Minh',
    }
    const out = localizeReferenceImportText(t)
    expect(out.title).toBe(t.title)
    expect(out.description).toBe('Type: Đất nền\nAddress: Tôn Đức Thắng, Bến Nghé, Quận 1, Hồ Chí Minh\nRent: 5,000,000 đ/month')
    expect(out.descriptionVi).toBe('Loại hình: Đất nền\nĐịa chỉ: Tôn Đức Thắng, Bến Nghé, Quận 1, Hồ Chí Minh')
    expect(out.missing).toEqual([
      { target: 'en', kind: 'title-location', src: 'Bến Nghé, Quận 1' },
      { target: 'en', kind: 'desc:Type', src: 'Đất nền' },
      { target: 'en', kind: 'desc:Address', src: 'Tôn Đức Thắng, Bến Nghé, Quận 1, Hồ Chí Minh' },
    ])
    // The Vietnamese title's location is looked up and reported like the other template's.
    const vi = localizeReferenceImportText({ ...t, titleVi: 'Cho thuê — Thao Dien Ward, District 2' })
    expect(vi.titleVi).toBe('Cho thuê — Thao Dien Ward, District 2')
    expect(vi.missing).toContainEqual({ target: 'vi', kind: 'titleVi-location', src: 'Thao Dien Ward, District 2' })
  })
})
