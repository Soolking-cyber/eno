import { describe, expect, it } from 'vitest'
import { entitiesSurvive, latinWordsSurvive } from './mt-entity-override'

describe('entitiesSurvive — accepts the measured false alarms', () => {
  it.each([
    ['scrape-glued sizes', 'Dây Da Apple Watch - 424445mm- 49mm Ultra', 'Leather Strap for Apple Watch - 42/44/45mm - 49mm Ultra'],
    ['scrape-glued model', 'Case AIRPODS 3Airpods ProAirpods 12', 'Case for AIRPODS 3, Airpods Pro, Airpods 12'],
    ['code glued through a diacritic', 'Sạc BST-C9009 - sạc4AA33004AAA1300', 'Charger BST-C9009 - charger 4AA33004AAA1300'],
    ['Vietnamese length notation', 'Bàn Làm Việc Cũ Mặt Gỗ Trắng 1m4', 'Used Desk with White Wooden Top, 1.4m'],
    ['word order moves numbers', 'Miếng dán kính cường lực 3D 0.25mm iPhone 18 Pro AVA+ JC', 'AVA+ JC 0.25mm 3D Tempered Glass Screen Protector for iPhone 18 Pro'],
    ['Vietnamese decimal comma', 'Pin sạc 1,5V AA', 'AA rechargeable battery 1.5V'],
    ['the owner example', 'Miếng dán camera iPhone 18 Pro/ iPhone 18 Pro Max Titanshield Mipow IRONBULL BJ18A-RD', 'Mipow IRONBULL BJ18A-RD Titanshield Camera Lens Protector for iPhone 18 Pro/iPhone 18 Pro Max'],
  ])('%s', (_, src, hyp) => expect(entitiesSurvive(src, hyp)).toBe(true))
})

describe('entitiesSurvive — rejects changed specifications', () => {
  it.each([
    ['dropped selected variant (measured)', 'Toner Astalock 100ml200ml - 100ml', 'Astalock Toner 100ml/200ml'],
    ['re-grouped digits (review)', 'Bộ nguồn 12V 3A', 'Power supply 1V 23A'],
    ['invented model number (measured)', 'Laptop HP Victus 15-FB3116AX BX8U4PA', 'Laptop HP EliteBook 840 G1 15-FB3116AX BX8U4PA'],
    ['dropped code (measured)', 'SẠC HYPERJUICE 66W GAN HJ265 - White', 'HYPERJUICE 66W GAN CHARGER - White'],
    ['dropped brand in capitals (measured)', 'Nước hoa hồng LÁ HOUSE Toner Astalock', 'Astalock Toner Hydrating'],
    ['voltage and current swapped (review)', 'Bộ nguồn 12V 3A', 'Power supply 3V 12A'],
    ['RAM and SSD sizes swapped (review)', 'Laptop Ram 8GB SSD 256GB', 'Laptop RAM 256GB SSD 8GB'],
    ['strap size and series swapped (review)', 'Dây 42mm Series 9', 'Strap 9mm Series 42'],
    ['unit changed outright (review)', 'Bộ nguồn 12V 3A', 'Power supply 12W 3A'],
    ['a value lost its unit (review)', 'Laptop RAM 8GB SSD 256GB', 'Laptop RAM 256GB SSD 8'],
    ['size and series swapped through a shared digit (review)', 'Dây 42mm Series 2', 'Strap 2mm Series 42'],
    ['decimal point moved — tenfold (review)', 'Sạc 15W', 'Charger 1.5W'],
  ])('%s', (_, src, hyp) => expect(entitiesSurvive(src, hyp)).toBe(false))
})

describe('latinWordsSurvive — no-diacritic product names', () => {
  it.each([
    ['colour changed (measured)', 'iPad Air 2 - 16GB/ Wifi + 4G (Gold) - Likenew 99%', 'iPad Air 2 - 16GB / Wifi + 4G (Meta) - Like New 99%'],
    ['brand dropped (measured)', 'Balo Laptop Sakos Attira 15.6 inch', 'Balo Laptop Bag Attira 15.6 inch'],
    ['model swapped (measured)', 'Laptop HP Victus 15-FB3116AX', 'Laptop HP EliteBook 840 G1 15-FB3116AX'],
    ['two-letter brand swapped (review)', 'Laptop HP Victus 15', 'Laptop Dell Victus 15'],
    ['word only survives as a substring (review)', 'Loa Air Mini', 'Chair speaker Mini'],
  ])('rejects: %s', (_, src, hyp) => expect(latinWordsSurvive(src, hyp)).toBe(false))

  it.each([
    ['Loa → Speaker', 'Loa Bluetooth Marshall Acton IV', 'Marshall Acton IV Bluetooth Speaker'],
    ['Tai nghe → Headphones', 'Tai nghe Bluetooth Xiaomi Redmi Buds 8 Pro', 'Xiaomi Redmi Buds 8 Pro Bluetooth Headset'],
    ['Tivi → TV', 'Smart Tivi LG Evo Oled 4K 77 inch 2025 (77G5PSA)', 'Smart TV LG Evo Oled 4K 77 inch 2025 (77G5PSA)'],
    ['Bao da → Leather Case', 'Bao da Apple iPad Pro 13 (M4/M5) Zagg Hampton Folio', 'Apple iPad Pro 13 Leather Case (M4/M5) Zagg Hampton Folio'],
    ['Balo → Backpack', 'Balo Laptop Sakos Attira 15.6 inch', 'Sakos Attira 15.6 inch Laptop Backpack'],
  ])('accepts: %s', (_, src, hyp) => expect(latinWordsSurvive(src, hyp)).toBe(true))
})
