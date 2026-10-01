import { describe, it, expect } from 'vitest'
import { classifyAdBanned, parseAbv, parseInfantAge, parseStage, prepAdText, type AdBanInput, type AdBanRule, type AdBanVerdict } from './ad-banned'

// The ad-banned classifier decides which imported rows never go live (ban AND review are skipped by
// every importer) and which live rows scripts/hide-ad-banned.ts may hide (ban only). Both directions
// are pinned: a false 'ban' takes a lawful product off the marketplace, a false 'ok' publishes an
// advertisement the Advertising Law forbids. Most titles below are LIVE rows (prod, 2026-10-01).

const v = (title: string, extra: Partial<AdBanInput> = {}) => classifyAdBanned({ title, ...extra })
const verdict = (title: string, extra: Partial<AdBanInput> = {}): AdBanVerdict => v(title, extra).verdict
const expectBan = (title: string, rule: AdBanRule, extra: Partial<AdBanInput> = {}) => {
  const r = v(title, extra)
  expect(r, title).toMatchObject({ verdict: 'ban', rule })
  expect(r.matched, title).toBeTruthy()
}

describe('the brief\'s live examples are caught', () => {
  it.each<[string, AdBanRule]>([
    ['Jose Cuervo tequila 40%', 'spirits'],
    ['Rượu HALICO 30°', 'spirits'],
    ['Soju Jinro Fresh', 'spirits'],
    ['Bình sữa Wesser', 'feeding_bottle'],
    ['Núm ti', 'teat'],
    ['Ti giả Philips Avent', 'teat'],
    ['Sữa Meiji 1-3', 'infant_formula'],
    ['Bravecto', 'vet_drug'],
  ])('%s → ban (%s)', (title, rule) => expectBan(title, rule))
})

describe('the brief\'s passes stay ok', () => {
  it.each([
    'Rượu vang đỏ 13.5%',
    'Bia Heineken 5%',
    'Sữa bột cho bé 2-6 tuổi',
    'Đồ chơi bình sữa búp bê',
  ])('%s → ok', (title) => expect(verdict(title)).toBe('ok'))
})

describe('spirits — strength is PARSED, 15% is the line', () => {
  it('bans a stated strength of 15% or more in every notation', () => {
    for (const t of ['Rượu nếp 15%', 'Vodka Hà Nội 39.5% vol', 'Rượu ngô 40 độ', 'Rượu Táo Mèo Liquor HALICO nồng độ 30v chai 500ml', 'Rượu JING 35 Vol 520ml', 'Rượu gạo ABV 29', 'Rượu 45°']) {
      expect(v(t), t).toMatchObject({ verdict: 'ban', rule: 'spirits' })
    }
  })

  it('passes wine and beer under 15%, including a low-strength spirit brand', () => {
    for (const t of ['Rượu vang ngọt Passion 750ml 11%', 'Bia Tiger 4.6% thùng 24 lon', 'Smirnoff Ice 4.5%', 'Soju Jinro vị đào 13%', 'Rượu vang Chile 14,5%']) {
      expect(verdict(t), t).toBe('ok')
    }
  })

  it('bans a spirit TYPE or BRAND even with no strength in the title (live Tiki rows)', () => {
    expectBan('Wild Turkey Aged 12 Years 50.5% Whiskey 1x0.7L', 'spirits')
    expectBan('Jgermeister 35 1x1.75L Liqueur', 'spirits')
    expectBan('Rượu Hà Nội HALICO nồng độ 35 can PE 2l không kèm hộp', 'spirits')
    expectBan('Bao Thanh Diamond Ginseng Liquor 500ml', 'spirits', { titleVi: 'Rượu nhân sâm Bảo Thanh 500ml kim cương' })
    expectBan('Genuine Korean Soju JINRO FRESH 360ml - Box of 20 bottles', 'spirits', { titleVi: 'CHÍNH HÃNG Soju Hàn Quốc JINRO FRESH 360ml - Thùng 20 chai' })
  })

  it('reads a strength the title omits from the description', () => {
    expect(v('Rượu Bàu Đá Bình Định', { description: 'Nồng độ 40%, chai 500ml' })).toMatchObject({ verdict: 'ban', rule: 'spirits' })
    expect(verdict('Rượu Bàu Đá Bình Định', { description: 'Nồng độ 12%' })).toBe('ok')
  })

  it('sends what it cannot settle to REVIEW, never to ban', () => {
    expect(verdict('Rượu Bàu Đá Bình Định')).toBe('review') // generic "rượu", no strength
    expect(verdict('GENUINE JINRO Korean Soju Combo 6 Bottles - Choose Your Flavors')).toBe('review') // fruit soju is 13%, Fresh is 16%
    expect(verdict('Rượu sake Nhật 720ml')).toBe('review')
  })

  it('does not read a discount, a condition or a temperature as a strength', () => {
    expect(verdict('Rượu vang Pháp giảm 20%')).toBe('ok')
    expect(verdict('Rượu vang Ý -30% hôm nay')).toBe('ok')
    expect(verdict('Tủ rượu vang Kadeka nhiệt độ 5-18 độ C')).toBe('ok')
    expect(parseAbv('ruou vang giam 20%')).toBeNull()
    expect(parseAbv('tu ruou nhiet do 12 do')).toBeNull()
    expect(parseAbv('ruou moi 99%')).toBeNull()
    expect(parseAbv('ruou nep moi 29.5%')).toBe(29.5) // "Nếp Mới" is a product name, not "new"
    expect(parseAbv('do con 40%')).toBe(40) // "độ cồn" is alcohol, not "còn"
  })

  it('passes accessories: glasses, cabinets, dispensers, racks (live rows)', () => {
    for (const [en, vi] of [
      ['Set of 6 Ocean Classic Brandy Glasses 1501X09 255ml', 'Bộ 6 Ly Rượu Ocean Classic Brandy 1501X09 255ml'],
      ['Modern Wine Display Cabinet 117cm x 255cm x 40cm', 'Tủ Trưng Bày Rượu 117CMx255CMx40CM Hiện Đại Giá Xưởng Mới 99%'],
      ['Set of 6 Premium Heat-Resistant Glass Tumblers for Water or Liquor Star Pattern - 240ml', 'Bộ 6 ly thủy tinh chịu nhiệt cao cấp dùng uống nước hoặc rượu tây vân sao'],
      ['Gas Pump Shaped Liquor Dispenser with Modern Pour Spout', 'Bình Đựng Rượu Hình Cây Xăng Kèm Vòi Rót Hiện Đại'],
      ['Smart Automatic Induction Wine Dispenser, Ultra-Convenient Touchless Liquor Decanter', 'Máy Rót Rượu Tự Động Cảm Ứng Thông Minh'],
      ['Wine Cooler Refrigerator - Model JC-48SBPFW Holds 18 Wine Bottles', 'Tủ làm mát rượu - Model JC-48SBPFW Chứa 18 Chai Vang'],
      ['Set of 6 Premium Silver-Inlaid Flared Rim Glass Liquor Cups', 'BỘ 6 LY THỦY TINH UỐNG RƯỢU KHẢM BẠC CAO CẤP MIỆNG LOE'],
    ]) expect(verdict(en, { titleVi: vi }), en).toBe('ok')
  })

  it('passes colours, furniture and tea that merely contain a drink word', () => {
    expect(verdict('ANELLO Medium Zipper Backpack AT-B0193A - Wine Red', { titleVi: 'Balo dây kéo ANELLO cỡ vừa AT-B0193A - Màu Đỏ Rượu' })).toBe('ok')
    expect(verdict('Selling a Red Sake Dining Table and Chairs Set, 99% New.', { titleVi: 'Thanh Lý Bộ Bàn Ghế Sake Màu Đỏ Mới 99%' })).toBe('ok')
    expect(verdict('Breadfruit Leaf Tea Bags 60g', { titleVi: 'Tra La Sake tui loc 60g' })).toBe('ok')
    expect(verdict('Dyson V8 Absolute vacuum cleaner')).toBe('ok') // ≠ Absolut
    expect(verdict('Túi xách da màu cognac')).toBe('ok')
  })

  it('passes books about drink, by keyword, by volume number and by category', () => {
    expect(verdict('Book: Wine Stories', { titleVi: 'Sách Kể Chuyện Rượu Vang' })).toBe('ok')
    expect(verdict('Otherworldly Izakaya Nobu - Volume 08', { titleVi: 'Quán Rượu Dị Giới Nobu - Tập 08' })).toBe('ok')
    expect(verdict('Book: Whiskey & Ribbons', { titleVi: 'Sách Whisky Và Ruy Băng' })).toBe('ok')
    expect(verdict('Rượu Độc Lóng Lánh', { category: 'books-stationery' })).toBe('ok')
  })

  it('a spirit named only in a description is review, never ban', () => {
    expect(v('Giỏ quà Tết cao cấp 2027', { description: 'Gồm 1 chai Chivas 18 700ml, bánh và trà' })).toMatchObject({ verdict: 'review', rule: 'spirits' })
  })

  it('does not treat jobs, rentals or property as advertising goods', () => {
    expect(verdict('Bartender — whisky bar Quận 1', { category: 'jobs' })).toBe('ok')
    expect(verdict('Căn hộ có tủ rượu, view sông', { category: 'rentals' })).toBe('ok')
  })
})

describe('tobacco and vapes', () => {
  it('bans vapes, pods and heated tobacco by name', () => {
    for (const t of ['Pod vape Relx Infinity', 'Tinh dầu vape 30ml', 'IQOS ILUMA chính hãng', 'Thuốc lá điện tử Vaporesso', 'Heets Amber thùng 10 gói', 'Elf Bar 5000 puffs']) {
      expect(v(t), t).toMatchObject({ verdict: 'ban', rule: 'vape' })
    }
  })

  it('bans cigarettes and cigars, but not an incidental or negated mention', () => {
    expectBan('Xì gà Cohiba Siglo VI hộp 10 điếu', 'tobacco')
    expectBan('Marlboro Gold carton', 'tobacco')
    // Live rows: a face mask against cigarette smoke, a stop-smoking book, a water-pipe bowl.
    expect(verdict('Unicharm 3D Face Masks Japan, Smog & Cigarette Smoke Prevention Box of 100 Pieces', { titleVi: 'Khẩu trang 3D Unicharm Nhật Bản ngăn ngừa khói bụi, thuốc lá hộp 100 chiếc' })).toBe('ok')
    expect(verdict('Book: Easy Way to Stop Smoking with Allen Carr', { titleVi: 'Sách Cai Thuốc Lá Dễ Dàng Cùng Allen Carr' })).toBe('ok')
    expect(verdict('Bat Trang Ceramic Blue Glaze Water Pipe Bowl with Antique Copper Rim', { titleVi: 'Điếu bát men lam bọc đồng cổ đồ gốm sứ Bát Tràng điếu hút thuốc lào' })).toBe('ok')
    expect(verdict('Tom Ford Tobacco Vanille EDP 50ml')).toBe('ok')
    expect(verdict('Bật lửa Zippo khắc tên')).toBe('ok')
  })

  it('a rental that forbids smoking or vaping is not tobacco', () => {
    expect(verdict('Phòng trọ Bình Thạnh', { description: 'Không hút thuốc lá, không vape trong phòng.' })).toBe('ok')
  })
})

describe('infant formula — AGE is parsed, 24 months is the line', () => {
  it('bans formula for under 24 months in every age notation (live rows)', () => {
    for (const [en, vi] of [
      ['2 Cans of Meiji 1-3 Growing Up Formula Milk Powder 800g', '2 Hộp Sữa Bột Meiji 1-3 Growing Up Formula 800g'],
      ['Abbott PediaSure Milk Powder 1.6kg for Children Aged 1-10 Years', 'Sữa bột Abbott Pediasure 1.6kg cho trẻ từ 1-10 tuổi'],
      ['Carton of 48 Cartons Abbott Similac Ready-to-Drink Milk 180ml for Children 1+ Years', 'Thùng 48 Hộp Sữa Nước Abbott Similac 180ml cho trẻ từ 1 tuổi'],
    ]) expect(v(en, { titleVi: vi }), en).toMatchObject({ verdict: 'ban', rule: 'infant_formula' })
    for (const t of ['Sữa bột Aptamil 0-6 tháng', 'Sữa công thức cho trẻ 6-12 tháng', 'Sữa bột Friso Gold số 1', 'Sữa bột cho trẻ sơ sinh Similac', 'Sữa bột Nan Optipro 6m+', 'Sữa bột Morinaga 1-2 tuổi']) {
      expect(v(t), t).toMatchObject({ verdict: 'ban', rule: 'infant_formula' })
    }
  })

  it('passes formula for 2 years and up, and milk for adults and mothers (live rows)', () => {
    for (const [en, vi] of [
      ['Friso Gold 4 Milk Powder 1400g for Children Aged 2 - 6 Years', 'Sữa Bột Friso Gold 4 1400g Dành Cho Trẻ Từ 2 - 6 Tuổi'],
      ['Similac 2 Milk Powder for Children Aged 2 - 6 Years - 800g', 'Sữa Bột Similac 2 Dành cho trẻ từ 2 - 6 tuổi - 800g'],
      ['Pediasure 10 Vanilla Milk Powder 800g for Children Aged 10 Years and Above', 'Sữa Bột Pediasure 10 Hương Vani 800g cho trẻ từ 10 tuổi trở lên'],
      ['Abbott Ensure Gold Milk Powder - Barley Flavor - 850g', 'Sữa Bột Abbott Ensure Gold Hương Lúa Mạch - 850g'],
      ['Frisomum Gold Orange Flavored Milk Powder 830g', 'Sữa Bột Friso mum Gold Hương Cam 830g'],
      ['Vinamilk Optimum Gold Step 4 Milk Powder Tin 1450g', 'Sữa bột VinamilkOptimum Gold Step 4 Hộp Thiếc 1450g'],
    ]) expect(verdict(en, { titleVi: vi }), en).toBe('ok')
  })

  it('sends an infant brand with no age, or a stage 2/3 with no age, to review', () => {
    expect(verdict('Abbott PediaSure Low-Sugar Vanilla Flavor Milk Powder 850g', { titleVi: 'Sữa bột Abbott Pediasure Hương Vani Ít Ngọt 850g' })).toBe('review')
    expect(verdict('Vinamilk Dielac Grow Plus 2 Colostrum Milk Powder 1400g Tin Can')).toBe('review')
    expect(verdict('Meiji Ezcube Growing Up Milk Cubes', { titleVi: 'Thanh Sữa Meiji Ezcube Growing Up Dạng Viên' })).toBe('review')
  })

  it('passes formula ACCESSORIES and things that only say "formula" (live rows)', () => {
    expect(verdict('Bear WW-4H12M Baby Formula Water Heater', { titleVi: 'Máy đun nước pha sữa Bear WW-4H12M' })).toBe('ok')
    expect(verdict('Joyoung JBM-530 Smart Baby Formula Maker', { titleVi: 'Máy pha sữa thông minh cho bé Joyoung JBM-530' })).toBe('ok')
    expect(verdict('Asus ROG MAXIMUS XII FORMULA Z490 LGA1200 Motherboard')).toBe('ok')
    expect(verdict("Men's Adidas Mercedes - Amg Petronas Formula 1 Team DNA T-Shirt - White")).toBe('ok')
    expect(verdict('Adult Cat Dry Food, Apro I.Q Formula Cat Kibble 500g')).toBe('ok')
    expect(verdict('Pack of 30 Glico PopCan Fruit Flavored Lollipops 13gr')).toBe('ok') // Glico ≠ Glico Icreo
    expect(verdict('Sữa chua Meiji vị dâu')).toBe('review') // a Meiji next to a milk word, no age — a human decides
  })
})

describe('feeding bottles and teats', () => {
  it('bans bottles and teats (live rows)', () => {
    expectBan('Wesser 260ml PPSU Baby Feeding Bottle', 'feeding_bottle', { titleVi: 'Bình sữa PPSU Wesser 260ml' })
    expectBan('Combo of 3 Wesser PP Baby Feeding Bottles 60ml, 140ml and 250ml', 'feeding_bottle', { titleVi: 'Combo 3 Bình Sữa Wesser PP 60ml, 140ml và 250ml' })
    expectBan('Wesser Narrow Neck Nipple Size L', 'teat', { titleVi: 'Núm vú Wesser cổ hẹp size L' })
    expectBan('Bình sữa Wesser tặng kèm cọ rửa', 'feeding_bottle') // the gift is the accessory, not the head
    expectBan('Phụ kiện: núm ti thay thế cho bình Pigeon', 'teat') // a teat sold "as an accessory" is still a teat
    expectBan('Ty giả silicone cho bé', 'teat')
  })

  it('passes bottle and pacifier ACCESSORIES (live rows)', () => {
    for (const [en, vi] of [
      ['Pack of 3 Wesser Baby Bottle Cleanser Refills 500ml x 3', 'Bộ 3 Gói Nước Rửa Bình Sữa Wesser 500ml x 3'],
      ['Wesser Multi-Purpose Baby Bottle Cleaning Brush - ORANGE', 'Dụng cụ vệ sinh bình sữa Wesser - MÀU CAM'],
      ['Safe PP Baby Bottle Handle for Wide-Neck Philips Avent Bottles for Self-Feeding', 'Tay Cầm Bình Sữa Philips Avent Cổ Rộng Cho Bé Tự Uống Sữa'],
      ['Clear Baby Pacifier & Soother Storage Case with Hanging Clip - Fits Philips Avent Soothers', 'Hộp Đựng Núm Ti Giả, Núm Ti Ngậm Cho Bé Trong Suốt, Có Móc Treo'],
    ]) expect(verdict(en, { titleVi: vi }), en).toBe('ok')
    expect(verdict('Phụ kiện bình sữa: ống hút và tay cầm')).toBe('ok') // phụ kiện that is not a teat
    expect(verdict('Máy hâm sữa Fatz Baby')).toBe('ok')
  })

  it('"tỉ giá" (exchange rate) is never a pacifier', () => {
    expect(verdict('Tỉ giá USD hôm nay tại Vietcombank')).toBe('ok')
    expect(verdict('Ti gia ngoai te hom nay')).toBe('ok')
    expect(verdict('Tỷ giá vàng SJC')).toBe('ok')
  })

  it('"núm vú" / "nipple" need a baby context; a description mention alone is ignored', () => {
    expect(verdict('Miếng dán núm vú silicone')).toBe('ok')
    expect(verdict('Xe đẩy em bé Joie', { description: 'Có ngăn để bình sữa và giỏ đồ lớn.' })).toBe('ok')
  })
})

describe('prescription and veterinary drugs', () => {
  it('bans veterinary prescription brands and prescription medicines (live rows)', () => {
    expectBan('Bravecto Flea, Tick, and Mange Treatment for Dogs 2 - 4.5kg', 'vet_drug', { titleVi: 'Bravecto diệt ghẻ, ve rận, bọ chét chó 2 - 4,5kg' })
    expectBan('MSD Bravecto24 Dog Flea, Tick, Mite and Lice Treatment Support 2 - 4 kg', 'vet_drug')
    expectBan('1 Chewable Tablet NexGard Spectra for Dogs 7,5 - 15kg', 'vet_drug')
    expectBan('Simparica Trio cho chó 10-20kg', 'vet_drug')
    expectBan('Amoxicillin 500mg hộp 10 vỉ', 'rx_drug')
    expectBan('Amoxicillin cho chó mèo', 'vet_drug')
  })

  it('a medicine name only in the description, or an unsettled vet product, is review', () => {
    expect(v('Combo chăm sóc thú cưng', { description: 'Tặng kèm 1 viên NexGard' })).toMatchObject({ verdict: 'review', rule: 'vet_drug' })
    expect(v('Fungikur 50ml Antifungal Spray for Dogs and Cats')).toMatchObject({ verdict: 'review', rule: 'vet_drug' })
  })

  it('passes books, appliances and natural remedies that merely mention medicine (live rows)', () => {
    expect(verdict('Book: Birth Control Pills - Little Benefit, Much Harm', { titleVi: 'Sách Thuốc Tránh Thai Lợi Ít Hại Nhiều' })).toBe('ok')
    expect(verdict('Truong An TA 37 Electric Herbal Medicine Decoction Pot Brown', { titleVi: 'Ấm săc thuốc Trường An TA 37 Nâu' })).toBe('ok')
    expect(verdict('Mật ong rừng - kháng sinh tự nhiên')).toBe('ok')
    expect(verdict('Map Permethrin 50 EC Mosquito Insecticide - 1 Bottle', { titleVi: 'Thuốc Diệt Muỗi Map Permethrin 50 EC - 1 chai' })).toBe('ok')
  })
})

// Every row below was a false 'ban' or 'review' in a dry run against the live catalogue
// (scripts/hide-ad-banned.ts, 2026-10-01) before the rule that now passes it was added.
describe('regressions from the live dry run', () => {
  it('Vietnamese syllables that fold to an English spirit are not spirits', () => {
    expect(verdict('Doi Dua Vang Crispy Family Beef Spring Rolls 480g Pack', { titleVi: 'Nem rán gia đình nhân thịt bò Đôi Đũa Vàng thơm ngọt giòn rụm gói 480g' })).toBe('ok')
    expect(verdict('Beyond Mars and Venus - Skills for Preserving and Growing Couple Life', { titleVi: 'Vượt Qua Chuyện Sao Hỏa, Sao Kim - Kỹ Năng Gìn Giữ Và Phát Triển Cuộc Sống Lứa Đôi' })).toBe('ok')
    expectBan('Bacardi Carta Blanca white rum 40% 750ml', 'spirits')
    expectBan('Rượu Gin Gordon\'s London Dry Gin 37.5%', 'spirits')
  })

  it('an author, a CPU codename and a charm are not spirits', () => {
    expect(verdict('The Outsider - Albert Camus', { titleVi: 'Kẻ Ngoại Cuộc - Albert Camus' })).toBe('ok')
    expect(verdict('HP EliteBook 840 G6 Core i5 8365U', { description: 'CPU Intel Core i5 thế hệ 8 Whiskey Lake 8365U 1.6Ghz' })).toBe('ok')
    expect(verdict('Phụ Kiện Jibbitz™ Crocs Strawberry Wine Floral - Đỏ', { description: 'Chất liệu: 45% nhựa, 55% cao su' })).toBe('ok')
    expect(verdict('Crocs Strawberry Wine Floral Jibbitz™ Charm - Red', { descriptionVi: 'Cách gắn Jibbitz: cầm nghiêng Jibbitz một góc 45 độ và ấn nhẹ vào lỗ' })).toBe('ok')
    expect(verdict('Phụ Kiện Jibbitz™ Crocs Champagne Cheers (1 Chiếc) - Vàng', { description: 'Chất liệu 45% PVC' })).toBe('ok')
  })

  it('a bottle-brand\'s shower gel is not a feeding bottle; nipple cream is not a teat', () => {
    expect(verdict('Set of 2 Bottles Wesser 2in1 Shower Gel & Shampoo Powder Scent 500ml x 2 - Orange', { titleVi: 'Bộ 2 Chai Sữa Tắm Gội Wesser 2in1 Hương Phấn 500ml x 2 - Cam' })).toBe('ok')
    expect(verdict('Medela Purelan Nipple Cream 37g for Dry, Cracked Nipples', { titleVi: 'Medela - Kem Purelan 37g - Dành cho mẹ có đầu ty khô, nứt, chảy máu' })).toBe('ok')
  })

  it('a storage bottle that can take a teat is review, not ban', () => {
    expect(v('Bình trữ sữa Medela PP 150ml - Nắp bình tách rời có thể lắp núm ty vào cho bé bú')).toMatchObject({ verdict: 'review', rule: 'teat' })
  })

  it('a strength in the description counts only next to a drink word', () => {
    expect(parseAbv('chat lieu 45% nhua', { needsDrinkWord: true })).toBeNull()
    expect(parseAbv('ruou nguyen chat 40%', { needsDrinkWord: true })).toBe(40)
    expect(parseAbv('chai 500ml nong do 40', { needsDrinkWord: true })).toBe(40)
    expect(parseAbv('liquor 30% abv 500ml bottle')).toBe(30) // the bottle size is not "ABV 50"
  })
})

describe('whole-listing exclusions and plumbing', () => {
  it('a toy, a sticker, a book are ok whatever they depict', () => {
    expect(verdict('Đồ chơi bình sữa búp bê')).toBe('ok')
    expect(verdict('Sticker Jack Daniel\'s dán laptop')).toBe('ok')
    expect(verdict('Sách hướng dẫn pha chế whisky')).toBe('ok')
    expect(verdict('Bình sữa cho búp bê', { subcategory: 'toys' })).toBe('ok')
  })

  it('"sạch" (clean) is not "sách" (book) once the accents are gone', () => {
    expect(verdict('Rượu sạch Bàu Đá 40 độ')).toBe('ban')
  })

  it('empty input is ok; the most severe rule wins', () => {
    expect(classifyAdBanned({})).toEqual({ verdict: 'ok', rule: null, matched: null })
    expect(classifyAdBanned({ title: '   ' }).verdict).toBe('ok')
    expect(v('Combo Pod vape + rượu sake').verdict).toBe('ban') // vape ban beats sake review
  })

  it('prepAdText folds accents and keeps the characters numbers need', () => {
    expect(prepAdText('Rượu HALICO 30° — 29,5% vol')).toBe('ruou halico 30° - 29,5% vol')
    expect(prepAdText('Jägermeister &amp; Co')).toBe('jagermeister co')
  })

  it('parseInfantAge / parseStage', () => {
    expect(parseInfantAge('sua bot cho be 0-6 thang')).toEqual({ loMonths: 0, kind: 'explicit' })
    expect(parseInfantAge('for children aged 2-6 years')).toEqual({ loMonths: 24, kind: 'explicit' })
    expect(parseInfantAge('cho tre tu 1 tuoi tro len')).toEqual({ loMonths: 12, kind: 'explicit' })
    expect(parseInfantAge('meiji 1-3 growing up')).toEqual({ loMonths: 12, kind: 'bare' })
    expect(parseInfantAge('bravecto 2 - 4,5kg')).toBeNull()
    expect(parseStage('sua bot friso gold so 1')).toBe(1)
    expect(parseStage('enfagrow a neuropro 4 830g')).toBe(4)
    expect(parseStage('sua bot meiji 1-3')).toBeNull()
    expect(parseStage('combo 2 sua bot anlene')).toBeNull()
  })
})

// Review round, 2026-10-01: a free-gift suffix used to whitelist a banned product (the exclusion fired
// on "đồ chơi"/"sticker"/"poster" anywhere in the title), and a spirit word on a non-drink auto-banned.
describe('a gift tacked onto the title does not excuse the product', () => {
  it.each<[string, AdBanRule]>([
    ['Sữa bột Friso Gold số 1 800g - Tặng đồ chơi', 'infant_formula'],
    ['Combo 2 lon Sữa Aptamil số 1 tặng 1 bộ đồ chơi xếp hình', 'infant_formula'],
    ['Bình sữa Pigeon 240ml tặng kèm móc khóa', 'feeding_bottle'],
    ['Bình sữa Wesser tặng sticker', 'feeding_bottle'],
    ['Rượu Vodka Hà Nội 29.5% tặng kèm decal', 'spirits'],
    ['Sữa Meiji số 0 800g tặng poster', 'infant_formula'],
  ])('%s → ban (%s)', (title, rule) => expectBan(title, rule))

  it('a toy, sticker or book that HEADS the title is still excused — "combo" right before it included', () => {
    expect(verdict('Đồ chơi bình sữa búp bê')).toBe('ok')
    expect(verdict('Combo đồ chơi bình sữa cho búp bê')).toBe('ok')
    expect(verdict('Bộ đồ chơi nấu ăn có bình sữa')).toBe('ok')
    expect(verdict('Sticker Jack Daniel\'s dán laptop')).toBe('ok')
    // A book's FORMAT counts wherever it stands — but not after a gift word.
    expect(verdict('Quán Rượu Dị Giới Nobu - Tập 08')).toBe('ok')
    expect(verdict('Rượu và văn hoá Việt - NXB Trẻ')).toBe('ok')
    expectBan('Bình sữa Avent 260ml tặng sách tập 1', 'feeding_bottle')
  })

  it('stage 0 (newborn) formula is under 24 months like stage 1', () => {
    expect(parseStage('sua meiji so 0 800g')).toBe(0)
    expect(parseStage('sua tuoi pro 0% duong')).toBeNull()
  })
})

describe('a spirit word on something that is not a drink is review, never ban', () => {
  it.each([
    'Áo thun Jack Daniel\'s cotton', 'Mũ lưỡi trai Hennessy', 'Ốp lưng iPhone 15 Chivas Regal', 'Nước hoa Hennessy for men',
    'Socola Hennessy', 'Bánh kem rượu rum', 'Nho khô ngâm rượu rum', 'Cà phê hương whisky', 'Tinh dầu thơm mùi whisky',
    'Rượu tắm thảo dược cho mẹ sau sinh', 'Rượu ngâm chân thảo dược', 'Đá viên ướp rượu whisky', 'Áo thun Smirnoff',
    'Nước hoa Hennessy 100ml', 'Sữa tắm hương whisky 500ml',
  ])('%s → review', (title) => expect(v(title)).toMatchObject({ verdict: 'review', rule: 'spirits' }))

  it('a drink head or a drink signal still bans — packs, flavours after the spirit, "rượu tăm"', () => {
    expectBan('Hennessy VSOP 700ml', 'spirits')
    expectBan('Rượu Chivas 18 năm', 'spirits')
    expectBan('Hộp quà cao cấp Chivas 18 700ml', 'spirits')
    expectBan('Combo 2 chai Smirnoff Vodka', 'spirits')
    expectBan('Rượu Vodka Men vị chanh 29.5%', 'spirits')
    expectBan('Rượu tăm Bắc Giang 45 độ', 'spirits')
  })

  it('a spirit brand with no drink signal and no drink head is review', () => {
    expect(v('Set quà Tết Chivas 12')).toMatchObject({ verdict: 'review', rule: 'spirits' })
    expect(v('Jack Daniel\'s Barbecue Sauce 553g')).toMatchObject({ verdict: 'review', rule: 'spirits' })
  })
})
