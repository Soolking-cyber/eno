// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL TAXONOMY — single source of truth for categories, subcategories,
// listing types (intent), and per-category facets.
//
// Consumed by: prisma/seed.ts (category upserts), the home category grid, the
// facet bar, the post wizard, and the SEO landing pages. Editing this file +
// reseeding categories is the ONLY place taxonomy changes are made.
//
// Design (per product decisions 2026-06-23):
//   • "What it is" (category/subcategory) is separate from "intent" (listingType).
//     A motorbike lives in Vehicles whether it's rented (rent) or sold (sell).
//   • Subcategory is chosen explicitly at post time (auto-suggested by keywords)
//     and stored on Listing.subcategorySlug — reliable filtering, accurate facets.
//   • Free & Giveaways and Wanted/ISO are INTENT SHORTCUTS (listingType filters
//     surfaced as chips), not real categories — so they don't double-code.
// ─────────────────────────────────────────────────────────────────────────────

import type { CategoryColor } from './types'

// ── Intent axis ──────────────────────────────────────────────────────────────
export type ListingType = 'sell' | 'rent' | 'wanted' | 'free' | 'service' | 'job' | 'event'

export const LISTING_TYPES: { value: ListingType; label: string; labelVi: string; icon: string }[] = [
  { value: 'sell', label: 'For sale', labelVi: 'Cần bán', icon: 'Tag' },
  { value: 'rent', label: 'For rent', labelVi: 'Cho thuê', icon: 'KeyRound' },
  { value: 'wanted', label: 'Wanted', labelVi: 'Cần mua', icon: 'Search' },
  { value: 'free', label: 'Free', labelVi: 'Cho tặng', icon: 'Gift' },
  { value: 'service', label: 'Service', labelVi: 'Dịch vụ', icon: 'Wrench' },
  { value: 'job', label: 'Job', labelVi: 'Việc làm', icon: 'Briefcase' },
  { value: 'event', label: 'Event', labelVi: 'Sự kiện', icon: 'CalendarDays' },
]

export const LISTING_TYPE_LABEL: Record<ListingType, { en: string; vi: string }> = Object.fromEntries(
  LISTING_TYPES.map((t) => [t.value, { en: t.label, vi: t.labelVi }]),
) as Record<ListingType, { en: string; vi: string }>

// Intent shortcuts surfaced in the category grid (not real categories — they map
// to a listingType filter across all categories).
export const INTENT_SHORTCUTS: { type: ListingType; name: string; nameVi: string; icon: string }[] = [
  { type: 'free', name: 'Free & Giveaways', nameVi: 'Cho tặng miễn phí', icon: 'Gift' },
  { type: 'wanted', name: 'Wanted / ISO', nameVi: 'Cần mua / Tìm', icon: 'Search' },
]

// ── Facets (per-category structured attributes) ──────────────────────────────
// A range facet stores a precise NUMBER on a dedicated Listing column (queryable
// as a min/max range), not in the stringly-typed `attributes` JSON. `column` is
// the Listing field; the wizard renders a draggable slider + number input, and the
// advanced filter renders a min–max range over the same scale.
export type RangeColumn = 'year' | 'mileageKm' | 'engineL' | 'engineCc'
export type RangeMeta = {
  min: number
  max: number
  step: number
  unit?: string        // shown after the value, e.g. 'km', 'L' (year has none)
  column: RangeColumn  // dedicated Listing column this facet reads/writes
}
export type FacetDef = {
  key: string
  label: string
  labelVi: string
  // How it renders: 'toggle' = segmented button group (short enums — gear, fuel);
  // 'select' = dropdown (longer lists — color); 'range' = numeric slider + min/max
  // filter over `range.column`. Default 'select'.
  kind?: 'toggle' | 'select' | 'range'
  range?: RangeMeta // required when kind === 'range'
  // Restrict this facet to certain subcategory slugs (e.g. cc engine for motorbikes
  // vs litre engine for cars). Absent = applies to every subcategory in the category.
  subcats?: string[]
  options: { value: string; label: string; labelVi: string }[]
}

// Newest selectable model year — current year + 1 (dealers list next-year models).
const MAX_YEAR = new Date().getFullYear() + 1

// ── Subcategories ────────────────────────────────────────────────────────────
export type SubcatDef = {
  slug: string
  name: string
  nameVi: string
  keywords: string[]
}

// ── Categories ───────────────────────────────────────────────────────────────
export type CategoryDef = {
  slug: string
  name: string
  nameVi: string
  icon: string // lucide icon name (must be registered in category-icons.tsx)
  color: CategoryColor // cosmetic — all collapse to the single brand blue
  description: string
  types: ListingType[] // intents valid for this category (drives wizard + filters)
  subcategories: SubcatDef[]
  facets: FacetDef[]
}

const COND: FacetDef = {
  key: 'condition',
  label: 'Condition',
  labelVi: 'Tình trạng',
  kind: 'toggle',
  options: [
    { value: 'new', label: 'New / Like new', labelVi: 'Mới / Như mới' },
    { value: 'used', label: 'Used', labelVi: 'Đã dùng' },
  ],
}

// Shared colour palette — used by several product categories.
const COLOR_OPTIONS = [
  { value: 'black', label: 'Black', labelVi: 'Đen' },
  { value: 'white', label: 'White', labelVi: 'Trắng' },
  { value: 'grey', label: 'Grey / Silver', labelVi: 'Xám / Bạc' },
  { value: 'red', label: 'Red', labelVi: 'Đỏ' },
  { value: 'blue', label: 'Blue', labelVi: 'Xanh dương' },
  { value: 'green', label: 'Green', labelVi: 'Xanh lá' },
  { value: 'neutral', label: 'Beige / Gold', labelVi: 'Be / Vàng' },
  { value: 'other', label: 'Other', labelVi: 'Khác' },
]

export const TAXONOMY: CategoryDef[] = [
  // 1 ── VEHICLES ─────────────────────────────────────────────────────────────
  {
    slug: 'vehicles',
    name: 'Vehicles',
    nameVi: 'Xe cộ',
    icon: 'Bike',
    color: 'sky',
    description: 'Buy or sell motorbikes, bicycles, cars, e-bikes, parts & gear. (To rent, see the Rentals category.)',
    types: ['sell', 'wanted'],
    subcategories: [
      { slug: 'motorbike-scooter', name: 'Motorbike (Scooter)', nameVi: 'Xe tay ga', keywords: ['scooter', 'vision', 'airblade', 'air blade', 'lead', 'sh', 'vespa', 'xe ga', 'tay ga'] },
      { slug: 'motorbike-manual', name: 'Motorbike (Manual)', nameVi: 'Xe số / Côn tay', keywords: ['manual', 'wave', 'sirius', 'exciter', 'winner', 'xe số', 'côn tay'] },
      { slug: 'bicycle', name: 'Bicycle', nameVi: 'Xe đạp', keywords: ['bicycle', 'bike', 'mountain bike', 'road bike', 'xe đạp'] },
      { slug: 'car', name: 'Car', nameVi: 'Ô tô', keywords: ['car', 'ô tô', 'sedan', 'suv', 'toyota', 'honda civic', 'mazda'] },
      { slug: 'ebike-scooter', name: 'E-bike / Electric scooter', nameVi: 'Xe điện', keywords: ['e-bike', 'ebike', 'electric', 'vinfast', 'xe điện'] },
      { slug: 'parts-gear', name: 'Parts & gear', nameVi: 'Phụ tùng & đồ bảo hộ', keywords: ['helmet', 'parts', 'tire', 'phụ tùng', 'mũ bảo hiểm', 'nón'] },
    ],
    facets: [
      { key: 'transmission', label: 'Transmission', labelVi: 'Hộp số', kind: 'toggle', options: [
        { value: 'automatic', label: 'Automatic', labelVi: 'Xe ga / Tự động' },
        { value: 'manual', label: 'Manual', labelVi: 'Xe số / Côn tay' },
      ] },
      { key: 'fuel', label: 'Fuel', labelVi: 'Nhiên liệu', kind: 'toggle', options: [
        { value: 'petrol', label: 'Petrol', labelVi: 'Xăng' },
        { value: 'electric', label: 'Electric', labelVi: 'Điện' },
        { value: 'diesel', label: 'Diesel', labelVi: 'Dầu' },
      ] },
      // Precise, draggable numeric specs (slider + type-in). Engine is subcategory-
      // aware: cc for motorbikes, LITRES (0.1 steps) for cars. Year & mileage exact.
      { key: 'year', label: 'Year', labelVi: 'Đời xe', kind: 'range', options: [],
        range: { min: 1990, max: MAX_YEAR, step: 1, column: 'year' } },
      { key: 'mileage', label: 'Mileage', labelVi: 'Số km đã đi', kind: 'range', options: [],
        range: { min: 0, max: 300000, step: 1000, unit: 'km', column: 'mileageKm' } },
      { key: 'engineCc', label: 'Engine', labelVi: 'Phân khối', kind: 'range', options: [],
        subcats: ['motorbike-scooter', 'motorbike-manual'],
        range: { min: 50, max: 1500, step: 5, unit: 'cc', column: 'engineCc' } },
      { key: 'engineL', label: 'Engine', labelVi: 'Dung tích', kind: 'range', options: [],
        subcats: ['car'],
        range: { min: 0.8, max: 6.0, step: 0.1, unit: 'L', column: 'engineL' } },
      { key: 'color', label: 'Color', labelVi: 'Màu sắc', options: COLOR_OPTIONS },
    ],
  },

  // ★ RENTALS (tourists & expats) ──────────────────────────────────────────────
  // The ONE place anything is rented. Tourists/expats look for "rent a bike",
  // "rent an apartment", "hotel" as nouns — not "Vehicles → filter Rent". So every
  // rental (transport + homes + short stays) lives here, intent always `rent`, with
  // the KeyRound 🔑 icon + "Cho thuê" (literally "for rent") as the visual signal.
  // Vehicles & Property are therefore BUY/SELL-ONLY — clean, non-overlapping split.
  {
    slug: 'rentals',
    name: 'Rentals',
    nameVi: 'Cho thuê',
    icon: 'KeyRound',
    color: 'sky',
    description: 'Rent — never buy. Motorbikes, cars, bicycles, e-bikes, plus apartments, houses, rooms, hotels & serviced stays. By the day, week or month. Built for tourists & expats.',
    types: ['rent'],
    subcategories: [
      // Transport rentals
      { slug: 'motorbike-rental', name: 'Motorbike & scooter', nameVi: 'Thuê xe máy', keywords: ['motorbike rental', 'scooter rental', 'rent a bike', 'bike rental', 'rent motorbike', 'vision', 'airblade', 'air blade', 'wave', 'monthly bike', 'thuê xe máy', 'thuê xe ga', 'thuê xe số'] },
      { slug: 'car-rental', name: 'Car (self-drive / with driver)', nameVi: 'Thuê ô tô', keywords: ['car rental', 'rent a car', 'self drive', 'self-drive', 'with driver', 'car hire', 'thuê ô tô', 'thuê xe hơi', 'thuê xe tự lái', 'thuê xe có tài'] },
      { slug: 'bicycle-rental', name: 'Bicycle', nameVi: 'Thuê xe đạp', keywords: ['bicycle rental', 'bike hire', 'rent bicycle', 'thuê xe đạp'] },
      { slug: 'ebike-rental', name: 'E-bike / e-scooter', nameVi: 'Thuê xe điện', keywords: ['e-bike rental', 'ebike rental', 'electric scooter rental', 'thuê xe điện'] },
      // Home rentals (long-term residential — moved out of Property, which is buy/sell-only)
      { slug: 'apartment-rental', name: 'Apartment / condo', nameVi: 'Thuê căn hộ', keywords: ['apartment rental', 'rent apartment', 'condo for rent', 'apartment for rent', 'thuê căn hộ', 'thuê chung cư'] },
      { slug: 'house-rental', name: 'House / villa', nameVi: 'Thuê nhà', keywords: ['house rental', 'rent house', 'villa for rent', 'townhouse for rent', 'thuê nhà', 'thuê nhà nguyên căn', 'thuê biệt thự'] },
      { slug: 'room-rental', name: 'Room / shared', nameVi: 'Thuê phòng / Ở ghép', keywords: ['room rental', 'rent room', 'roommate', 'shared room', 'thuê phòng', 'phòng trọ', 'ở ghép'] },
      // Short-term / serviced stays (tourists + arriving expats)
      { slug: 'hotel-short-stay', name: 'Hotel & short-stay', nameVi: 'Khách sạn & ngắn hạn', keywords: ['hotel', 'hostel', 'guesthouse', 'short stay', 'short-term stay', 'nightly', 'airbnb', 'khách sạn', 'nhà nghỉ', 'lưu trú ngắn hạn'] },
      { slug: 'homestay-serviced', name: 'Homestay & serviced apartment', nameVi: 'Homestay & căn hộ dịch vụ', keywords: ['homestay', 'serviced apartment', 'service apartment', 'furnished stay', 'căn hộ dịch vụ'] },
    ],
    facets: [
      { key: 'rentalPeriod', label: 'Rental period', labelVi: 'Kỳ thuê', kind: 'toggle', options: [
        { value: 'daily', label: 'Daily', labelVi: 'Theo ngày' },
        { value: 'weekly', label: 'Weekly', labelVi: 'Theo tuần' },
        { value: 'monthly', label: 'Monthly', labelVi: 'Theo tháng' },
      ] },
      { key: 'transmission', label: 'Transmission', labelVi: 'Hộp số', kind: 'toggle',
        subcats: ['motorbike-rental', 'car-rental'], options: [
        { value: 'automatic', label: 'Automatic', labelVi: 'Tự động / Xe ga' },
        { value: 'manual', label: 'Manual', labelVi: 'Số / Côn tay' },
      ] },
      { key: 'delivery', label: 'Delivery', labelVi: 'Giao nhận', kind: 'toggle',
        subcats: ['motorbike-rental', 'car-rental', 'bicycle-rental', 'ebike-rental'], options: [
        { value: 'delivered', label: 'Delivered to you', labelVi: 'Giao tận nơi' },
        { value: 'pickup', label: 'Self-pickup', labelVi: 'Tự đến lấy' },
      ] },
      { key: 'bedrooms', label: 'Bedrooms', labelVi: 'Phòng ngủ', kind: 'toggle',
        subcats: ['apartment-rental', 'house-rental', 'room-rental'], options: [
        { value: '0', label: 'Studio', labelVi: 'Studio' },
        { value: '1', label: '1 BR', labelVi: '1 PN' },
        { value: '2', label: '2 BR', labelVi: '2 PN' },
        { value: '3', label: '3+ BR', labelVi: '3+ PN' },
      ] },
      { key: 'furnishing', label: 'Furnishing', labelVi: 'Nội thất', kind: 'toggle',
        subcats: ['apartment-rental', 'house-rental', 'room-rental', 'homestay-serviced'], options: [
        { value: 'fully', label: 'Furnished', labelVi: 'Đầy đủ' },
        { value: 'partly', label: 'Unfurnished', labelVi: 'Cơ bản' },
      ] },
      { key: 'guests', label: 'Guests', labelVi: 'Số khách', kind: 'toggle',
        subcats: ['hotel-short-stay', 'homestay-serviced'], options: [
        { value: '1-2', label: '1–2', labelVi: '1–2' },
        { value: '3-4', label: '3–4', labelVi: '3–4' },
        { value: '5-up', label: '5+', labelVi: '5+' },
      ] },
    ],
  },

  // 2 ── PROPERTY (buy/sell only) ──────────────────────────────────────────────
  // Real estate to BUY or SELL. Anything for rent (apartments, houses, rooms) lives
  // in the Rentals category instead — Property never carries the `rent` intent.
  {
    slug: 'property',
    name: 'Property',
    nameVi: 'Nhà đất',
    icon: 'Home',
    color: 'teal',
    description: 'Apartments, houses, land, offices & retail — to buy or sell. (To rent a home, see the Rentals category.)',
    types: ['sell', 'wanted'],
    subcategories: [
      { slug: 'apartment', name: 'Apartment / Condo', nameVi: 'Căn hộ / Chung cư', keywords: ['apartment', 'condo', 'buy apartment', 'căn hộ', 'chung cư', 'mua căn hộ'] },
      { slug: 'house', name: 'House / Villa', nameVi: 'Nhà / Biệt thự', keywords: ['house', 'villa', 'townhouse', 'buy house', 'nhà nguyên căn', 'nhà phố', 'biệt thự', 'mua nhà'] },
      { slug: 'land', name: 'Land & plots', nameVi: 'Đất nền', keywords: ['land', 'plot', 'lot', 'đất', 'đất nền', 'lô đất', 'thổ cư'] },
      { slug: 'office-retail', name: 'Office & retail', nameVi: 'Văn phòng & Mặt bằng', keywords: ['office', 'retail', 'commercial', 'shop', 'văn phòng', 'mặt bằng'] },
    ],
    facets: [
      { key: 'bedrooms', label: 'Bedrooms', labelVi: 'Phòng ngủ', kind: 'toggle', options: [
        { value: '0', label: 'Studio', labelVi: 'Studio' },
        { value: '1', label: '1 BR', labelVi: '1 PN' },
        { value: '2', label: '2 BR', labelVi: '2 PN' },
        { value: '3', label: '3+ BR', labelVi: '3+ PN' },
      ] },
      { key: 'area', label: 'Area', labelVi: 'Diện tích', options: [
        { value: 'under-40', label: 'Under 40 m²', labelVi: 'Dưới 40 m²' },
        { value: '40-70', label: '40–70 m²', labelVi: '40–70 m²' },
        { value: '70-100', label: '70–100 m²', labelVi: '70–100 m²' },
        { value: 'over-100', label: 'Over 100 m²', labelVi: 'Trên 100 m²' },
      ] },
      { key: 'furnishing', label: 'Furnishing', labelVi: 'Nội thất', kind: 'toggle', options: [
        { value: 'fully', label: 'Furnished', labelVi: 'Đầy đủ' },
        { value: 'partly', label: 'Unfurnished', labelVi: 'Cơ bản' },
      ] },
    ],
  },

  // 3 ── MOVING SALE (flagship) ─────────────────────────────────────────────────
  {
    slug: 'moving-sale',
    name: 'Moving Sale',
    nameVi: 'Đồ thanh lý',
    icon: 'PackageOpen',
    color: 'brand',
    description: 'Leaving Vietnam? Whole-home liquidations — furniture, appliances and more in one go.',
    types: ['sell', 'free'],
    subcategories: [
      { slug: 'whole-home', name: 'Whole-home bundle', nameVi: 'Trọn gói cả nhà', keywords: ['whole home', 'everything', 'moving out', 'cả nhà', 'trọn gói'] },
      { slug: 'furniture', name: 'Furniture', nameVi: 'Nội thất', keywords: ['sofa', 'table', 'bed', 'cabinet', 'desk', 'ghế', 'bàn', 'giường', 'tủ'] },
      { slug: 'appliances', name: 'Appliances', nameVi: 'Đồ gia dụng', keywords: ['fridge', 'washer', 'microwave', 'aircon', 'tủ lạnh', 'máy giặt', 'lò vi sóng', 'máy lạnh'] },
      { slug: 'kitchen-home', name: 'Kitchen & home', nameVi: 'Bếp & gia dụng nhỏ', keywords: ['kitchen', 'cookware', 'plates', 'bếp', 'nồi', 'chén'] },
      { slug: 'misc', name: 'Everything else', nameVi: 'Đồ linh tinh', keywords: ['misc', 'various', 'linh tinh'] },
    ],
    facets: [COND],
  },

  // 4 ── FURNITURE & APPLIANCES ─────────────────────────────────────────────────
  {
    slug: 'furniture-appliances',
    name: 'Furniture & Appliances',
    nameVi: 'Nội thất & Gia dụng',
    icon: 'Sofa',
    color: 'indigo',
    description: 'Sofas, beds, tables, storage, lighting, fridges, washers, ACs, plants & garden.',
    types: ['sell', 'free', 'wanted'],
    subcategories: [
      { slug: 'sofa-seating', name: 'Sofa & seating', nameVi: 'Sofa & Ghế', keywords: ['sofa', 'couch', 'armchair', 'chair', 'ghế', 'sofa'] },
      { slug: 'tables-desks', name: 'Tables & desks', nameVi: 'Bàn & Bàn làm việc', keywords: ['table', 'desk', 'dining', 'bàn', 'bàn làm việc'] },
      { slug: 'beds-mattresses', name: 'Beds & mattresses', nameVi: 'Giường & Nệm', keywords: ['bed', 'mattress', 'giường', 'nệm'] },
      { slug: 'storage', name: 'Storage & wardrobes', nameVi: 'Tủ & Kệ', keywords: ['wardrobe', 'cabinet', 'shelf', 'tủ', 'kệ'] },
      { slug: 'lighting-decor', name: 'Lighting & decor', nameVi: 'Đèn & Trang trí', keywords: ['lamp', 'light', 'decor', 'rug', 'đèn', 'trang trí', 'thảm'] },
      { slug: 'white-goods', name: 'Fridge / Washer / AC', nameVi: 'Tủ lạnh / Máy giặt / Máy lạnh', keywords: ['fridge', 'refrigerator', 'washer', 'air conditioner', 'aircon', 'tủ lạnh', 'máy giặt', 'máy lạnh'] },
      { slug: 'kitchenware', name: 'Kitchenware', nameVi: 'Đồ bếp', keywords: ['kitchen', 'cookware', 'pan', 'pot', 'bếp', 'nồi', 'chảo'] },
      { slug: 'plants-garden', name: 'Plants & garden', nameVi: 'Cây cảnh & Sân vườn', keywords: ['plant', 'garden', 'pot', 'cây', 'cây cảnh', 'sân vườn'] },
    ],
    facets: [
      COND,
      { key: 'material', label: 'Material', labelVi: 'Chất liệu', options: [
        { value: 'wood', label: 'Wood', labelVi: 'Gỗ' },
        { value: 'fabric', label: 'Fabric', labelVi: 'Vải' },
        { value: 'metal', label: 'Metal', labelVi: 'Kim loại' },
      ] },
    ],
  },

  // 5 ── ELECTRONICS ────────────────────────────────────────────────────────────
  {
    slug: 'electronics',
    name: 'Electronics',
    nameVi: 'Điện tử',
    icon: 'Smartphone',
    color: 'indigo',
    description: 'Phones, laptops, TVs, audio, cameras, gaming, accessories & components.',
    types: ['sell', 'wanted', 'free'],
    subcategories: [
      { slug: 'phones-tablets', name: 'Phones & tablets', nameVi: 'Điện thoại & Máy tính bảng', keywords: ['iphone', 'ipad', 'phone', 'tablet', 'samsung', 'điện thoại', 'máy tính bảng'] },
      { slug: 'laptops-pcs', name: 'Laptops & computers', nameVi: 'Laptop & Máy tính', keywords: ['macbook', 'laptop', 'pc', 'computer', 'dell', 'asus', 'thinkpad', 'máy tính'] },
      { slug: 'tv-monitors', name: 'TVs & monitors', nameVi: 'Tivi & Màn hình', keywords: ['tv', 'television', 'monitor', 'tivi', 'màn hình'] },
      { slug: 'audio', name: 'Audio', nameVi: 'Âm thanh', keywords: ['speaker', 'headphone', 'airpods', 'earbuds', 'loa', 'tai nghe'] },
      { slug: 'cameras', name: 'Cameras', nameVi: 'Máy ảnh', keywords: ['camera', 'sony', 'canon', 'fujifilm', 'lens', 'máy ảnh', 'ống kính'] },
      { slug: 'gaming', name: 'Gaming', nameVi: 'Máy chơi game', keywords: ['playstation', 'ps5', 'xbox', 'nintendo', 'switch', 'console', 'game'] },
      { slug: 'accessories', name: 'Accessories & components', nameVi: 'Phụ kiện & Linh kiện', keywords: ['charger', 'cable', 'ram', 'ssd', 'keyboard', 'mouse', 'phụ kiện', 'linh kiện'] },
    ],
    facets: [
      COND,
      { key: 'storage', label: 'Storage', labelVi: 'Bộ nhớ', kind: 'toggle', options: [
        { value: '64', label: '64 GB', labelVi: '64 GB' },
        { value: '128', label: '128 GB', labelVi: '128 GB' },
        { value: '256', label: '256 GB', labelVi: '256 GB' },
        { value: '512-up', label: '512 GB+', labelVi: '512 GB+' },
      ] },
      { key: 'ram', label: 'RAM', labelVi: 'RAM', kind: 'toggle', options: [
        { value: '4-8', label: '4–8 GB', labelVi: '4–8 GB' },
        { value: '16', label: '16 GB', labelVi: '16 GB' },
        { value: '32-up', label: '32 GB+', labelVi: '32 GB+' },
      ] },
      { key: 'color', label: 'Color', labelVi: 'Màu sắc', options: COLOR_OPTIONS },
      { key: 'warranty', label: 'Warranty', labelVi: 'Bảo hành', kind: 'toggle', options: [
        { value: 'yes', label: 'In warranty', labelVi: 'Còn bảo hành' },
        { value: 'no', label: 'No warranty', labelVi: 'Hết bảo hành' },
      ] },
    ],
  },

  // 6 ── FASHION & BEAUTY ───────────────────────────────────────────────────────
  {
    slug: 'fashion-beauty',
    name: 'Fashion & Beauty',
    nameVi: 'Thời trang & Làm đẹp',
    icon: 'Shirt',
    color: 'violet',
    description: "Women's & men's clothing, shoes, bags, watches, jewelry and cosmetics.",
    types: ['sell', 'wanted'],
    subcategories: [
      { slug: 'womens', name: "Women's clothing", nameVi: 'Thời trang nữ', keywords: ['dress', 'women', 'skirt', 'đầm', 'váy', 'nữ'] },
      { slug: 'mens', name: "Men's clothing", nameVi: 'Thời trang nam', keywords: ['men', 'shirt', 'jacket', 'áo', 'quần', 'nam'] },
      { slug: 'shoes', name: 'Shoes', nameVi: 'Giày dép', keywords: ['shoes', 'sneakers', 'heels', 'giày', 'dép'] },
      { slug: 'bags', name: 'Bags & wallets', nameVi: 'Túi & Ví', keywords: ['bag', 'backpack', 'wallet', 'túi', 'ví', 'balo'] },
      { slug: 'watches-jewelry', name: 'Watches & jewelry', nameVi: 'Đồng hồ & Trang sức', keywords: ['watch', 'jewelry', 'ring', 'necklace', 'đồng hồ', 'trang sức', 'nhẫn'] },
      { slug: 'beauty', name: 'Beauty & cosmetics', nameVi: 'Mỹ phẩm & Làm đẹp', keywords: ['cosmetics', 'makeup', 'skincare', 'perfume', 'mỹ phẩm', 'nước hoa'] },
    ],
    facets: [
      COND,
      { key: 'gender', label: 'For', labelVi: 'Dành cho', kind: 'toggle', options: [
        { value: 'women', label: 'Women', labelVi: 'Nữ' },
        { value: 'men', label: 'Men', labelVi: 'Nam' },
        { value: 'unisex', label: 'Unisex', labelVi: 'Unisex' },
      ] },
      { key: 'size', label: 'Size', labelVi: 'Kích cỡ', kind: 'toggle', options: [
        { value: 'xs-s', label: 'XS–S', labelVi: 'XS–S' },
        { value: 'm', label: 'M', labelVi: 'M' },
        { value: 'l', label: 'L', labelVi: 'L' },
        { value: 'xl-up', label: 'XL+', labelVi: 'XL+' },
      ] },
      { key: 'color', label: 'Color', labelVi: 'Màu sắc', options: COLOR_OPTIONS },
    ],
  },

  // 7 ── BABY & KIDS ────────────────────────────────────────────────────────────
  {
    slug: 'baby-kids',
    name: 'Baby & Kids',
    nameVi: 'Mẹ & Bé',
    icon: 'Baby',
    color: 'cyan',
    description: 'Strollers, car seats, baby gear, toys, kids clothing and maternity.',
    types: ['sell', 'free', 'wanted'],
    subcategories: [
      { slug: 'strollers-seats', name: 'Strollers & car seats', nameVi: 'Xe đẩy & Ghế ngồi ô tô', keywords: ['stroller', 'pram', 'car seat', 'xe đẩy', 'ghế ô tô'] },
      { slug: 'baby-gear', name: 'Baby gear & furniture', nameVi: 'Đồ dùng & Nội thất cho bé', keywords: ['crib', 'cot', 'high chair', 'baby', 'cũi', 'nôi', 'ghế ăn'] },
      { slug: 'toys', name: 'Toys & games', nameVi: 'Đồ chơi', keywords: ['toy', 'lego', 'game', 'đồ chơi'] },
      { slug: 'kids-clothing', name: "Kids' clothing", nameVi: 'Quần áo trẻ em', keywords: ['kids clothes', 'children', 'quần áo trẻ em', 'đồ trẻ em'] },
      { slug: 'maternity', name: 'Maternity', nameVi: 'Đồ bầu', keywords: ['maternity', 'pregnancy', 'đồ bầu', 'bà bầu'] },
    ],
    facets: [COND],
  },

  // 8 ── HOBBIES, SPORTS & BOOKS ────────────────────────────────────────────────
  {
    slug: 'hobbies-sports',
    name: 'Hobbies, Sports & Books',
    nameVi: 'Sở thích & Thể thao',
    icon: 'Dumbbell',
    color: 'sky',
    description: 'Fitness gear, instruments, English books, board games, collectibles, camping & outdoors.',
    types: ['sell', 'wanted', 'free'],
    subcategories: [
      { slug: 'fitness', name: 'Fitness & gym gear', nameVi: 'Dụng cụ thể thao', keywords: ['dumbbell', 'weights', 'yoga', 'gym', 'treadmill', 'tạ', 'thể thao'] },
      { slug: 'instruments', name: 'Musical instruments', nameVi: 'Nhạc cụ', keywords: ['guitar', 'piano', 'keyboard', 'instrument', 'đàn', 'nhạc cụ'] },
      { slug: 'books', name: 'Books & magazines', nameVi: 'Sách & Tạp chí', keywords: ['book', 'novel', 'english book', 'sách', 'truyện'] },
      { slug: 'board-games', name: 'Board games & collectibles', nameVi: 'Boardgame & Sưu tầm', keywords: ['board game', 'boardgame', 'collectible', 'figure', 'lego', 'sưu tầm'] },
      { slug: 'camping-outdoor', name: 'Camping & outdoor', nameVi: 'Cắm trại & Dã ngoại', keywords: ['camping', 'tent', 'hiking', 'outdoor', 'cắm trại', 'lều'] },
      { slug: 'art-crafts', name: 'Art & crafts', nameVi: 'Nghệ thuật & Thủ công', keywords: ['art', 'painting', 'craft', 'tranh', 'thủ công'] },
    ],
    facets: [COND],
  },

  // 9 ── PETS ───────────────────────────────────────────────────────────────────
  {
    slug: 'pets',
    name: 'Pets',
    nameVi: 'Thú cưng',
    icon: 'PawPrint',
    color: 'teal',
    description: 'Dogs, cats, adoption & rehoming, supplies, birds, fish and more.',
    types: ['sell', 'free', 'wanted'],
    subcategories: [
      { slug: 'dogs', name: 'Dogs', nameVi: 'Chó', keywords: ['dog', 'puppy', 'chó', 'cún'] },
      { slug: 'cats', name: 'Cats', nameVi: 'Mèo', keywords: ['cat', 'kitten', 'mèo'] },
      { slug: 'adoption', name: 'Adoption / Rehoming', nameVi: 'Nhận nuôi', keywords: ['adopt', 'adoption', 'rehome', 'rescue', 'nhận nuôi', 'cho nhận nuôi'] },
      { slug: 'supplies', name: 'Pet supplies', nameVi: 'Phụ kiện thú cưng', keywords: ['pet food', 'cage', 'leash', 'thức ăn', 'lồng', 'phụ kiện thú cưng'] },
      { slug: 'other-pets', name: 'Birds, fish & other', nameVi: 'Chim, cá & khác', keywords: ['bird', 'fish', 'aquarium', 'hamster', 'chim', 'cá', 'thú cưng khác'] },
    ],
    facets: [],
  },

  // 10 ── JOBS ──────────────────────────────────────────────────────────────────
  {
    slug: 'jobs',
    name: 'Jobs',
    nameVi: 'Việc làm',
    icon: 'Briefcase',
    color: 'violet',
    description: 'Teaching, hospitality, IT, sales, marketing, admin, healthcare, trades, remote & internships.',
    types: ['job', 'wanted'],
    subcategories: [
      { slug: 'teaching', name: 'Teaching & education', nameVi: 'Giảng dạy & Giáo dục', keywords: ['teacher', 'teaching', 'english', 'tutor', 'esl', 'giáo viên', 'gia sư'] },
      { slug: 'hospitality', name: 'Hospitality & F&B', nameVi: 'Nhà hàng & Khách sạn', keywords: ['barista', 'waiter', 'chef', 'hotel', 'f&b', 'phục vụ', 'pha chế'] },
      { slug: 'sales-cs', name: 'Sales & customer service', nameVi: 'Bán hàng & CSKH', keywords: ['sales', 'customer service', 'telesale', 'bán hàng', 'cskh'] },
      { slug: 'it-design', name: 'IT, tech & design', nameVi: 'IT & Thiết kế', keywords: ['developer', 'software', 'engineer', 'designer', 'it', 'thiết kế', 'lập trình'] },
      { slug: 'marketing-media', name: 'Marketing & media', nameVi: 'Marketing & Truyền thông', keywords: ['marketing', 'content', 'media', 'social media', 'truyền thông'] },
      { slug: 'office-admin', name: 'Office & admin', nameVi: 'Văn phòng & Hành chính', keywords: ['admin', 'office', 'accountant', 'hr', 'hành chính', 'kế toán'] },
      { slug: 'healthcare', name: 'Healthcare', nameVi: 'Y tế', keywords: ['nurse', 'doctor', 'healthcare', 'y tế', 'điều dưỡng'] },
      { slug: 'trades-labor', name: 'Skilled trades & labor', nameVi: 'Lao động & Kỹ thuật', keywords: ['driver', 'labor', 'technician', 'lao động', 'tài xế', 'kỹ thuật'] },
      { slug: 'remote-freelance', name: 'Remote & freelance', nameVi: 'Từ xa & Freelance', keywords: ['remote', 'freelance', 'work from home', 'từ xa', 'freelancer'] },
      { slug: 'internship', name: 'Internships', nameVi: 'Thực tập', keywords: ['intern', 'internship', 'thực tập'] },
    ],
    facets: [
      { key: 'jobtype', label: 'Type', labelVi: 'Hình thức', options: [
        { value: 'fulltime', label: 'Full-time', labelVi: 'Toàn thời gian' },
        { value: 'parttime', label: 'Part-time', labelVi: 'Bán thời gian' },
        { value: 'contract', label: 'Contract', labelVi: 'Hợp đồng' },
        { value: 'remote', label: 'Remote', labelVi: 'Từ xa' },
      ] },
      { key: 'english', label: 'English', labelVi: 'Tiếng Anh', options: [
        { value: 'required', label: 'Required', labelVi: 'Yêu cầu' },
      ] },
    ],
  },

  // 11 ── SERVICES ──────────────────────────────────────────────────────────────
  {
    slug: 'services',
    name: 'Services',
    nameVi: 'Dịch vụ',
    icon: 'Wrench',
    color: 'cyan',
    description: 'Visa & legal, language lessons, cleaning, moving, repairs, beauty, fitness, photography, childcare & more.',
    types: ['service', 'wanted'],
    subcategories: [
      { slug: 'visa-legal', name: 'Visa, legal & tax', nameVi: 'Visa, Pháp lý & Thuế', keywords: ['visa', 'work permit', 'legal', 'tax', 'permit', 'giấy tờ', 'thuế', 'pháp lý'] },
      { slug: 'language-lessons', name: 'Language lessons', nameVi: 'Lớp ngoại ngữ', keywords: ['vietnamese lesson', 'english class', 'language', 'học tiếng việt', 'dạy tiếng', 'ngoại ngữ'] },
      { slug: 'coworking', name: 'Coworking & desks', nameVi: 'Coworking & bàn làm việc', keywords: ['coworking', 'co-working', 'hot desk', 'day pass', 'dedicated desk', 'shared office', 'workspace', 'không gian làm việc chung', 'văn phòng chia sẻ'] },
      { slug: 'airport-transfer', name: 'Airport transfer & driver', nameVi: 'Đưa đón sân bay & tài xế', keywords: ['airport transfer', 'airport pickup', 'private transfer', 'driver', 'car with driver', 'đưa đón sân bay', 'tài xế', 'thuê xe có tài'] },
      { slug: 'cleaning', name: 'Cleaning & maid', nameVi: 'Dọn dẹp & Giúp việc', keywords: ['cleaning', 'maid', 'housekeeping', 'dọn dẹp', 'giúp việc', 'vệ sinh'] },
      { slug: 'moving-delivery', name: 'Moving & delivery', nameVi: 'Chuyển nhà & Giao hàng', keywords: ['moving', 'delivery', 'transport', 'chuyển nhà', 'vận chuyển', 'giao hàng'] },
      { slug: 'repair', name: 'Repair & handyman', nameVi: 'Sửa chữa', keywords: ['repair', 'handyman', 'plumber', 'electrician', 'fix', 'sửa chữa', 'thợ'] },
      { slug: 'beauty-wellness', name: 'Beauty & wellness', nameVi: 'Làm đẹp & Thư giãn', keywords: ['salon', 'spa', 'massage', 'nails', 'làm đẹp', 'thư giãn'] },
      { slug: 'fitness-pt', name: 'Fitness, PT & yoga', nameVi: 'Thể hình, PT & Yoga', keywords: ['personal trainer', 'pt', 'yoga', 'fitness', 'gym', 'huấn luyện viên'] },
      { slug: 'photography', name: 'Photography & creative', nameVi: 'Chụp ảnh & Sáng tạo', keywords: ['photographer', 'photography', 'video', 'chụp ảnh', 'quay phim'] },
      { slug: 'childcare', name: 'Childcare & nanny', nameVi: 'Trông trẻ & Giúp việc nhà', keywords: ['nanny', 'babysitter', 'childcare', 'trông trẻ', 'giữ trẻ'] },
      { slug: 'pet-services', name: 'Pet services', nameVi: 'Dịch vụ thú cưng', keywords: ['pet grooming', 'pet sitting', 'vet', 'grooming', 'thú y', 'chăm sóc thú cưng'] },
      { slug: 'financial', name: 'Financial & insurance', nameVi: 'Tài chính & Bảo hiểm', keywords: ['insurance', 'financial', 'remittance', 'bảo hiểm', 'tài chính'] },
    ],
    facets: [],
  },

  // 12 ── COMMUNITY & EVENTS ────────────────────────────────────────────────────
  {
    slug: 'community-events',
    name: 'Community & Events',
    nameVi: 'Cộng đồng & Sự kiện',
    icon: 'Users',
    color: 'brand',
    description: 'Meetups, language exchange, classes, sports clubs, lost & found and volunteering.',
    types: ['event', 'free'],
    subcategories: [
      { slug: 'events-meetups', name: 'Events & meetups', nameVi: 'Sự kiện & Gặp gỡ', keywords: ['event', 'meetup', 'party', 'sự kiện', 'gặp gỡ'] },
      { slug: 'language-exchange', name: 'Language exchange', nameVi: 'Giao lưu ngôn ngữ', keywords: ['language exchange', 'conversation', 'giao lưu', 'trao đổi ngôn ngữ'] },
      { slug: 'classes-workshops', name: 'Classes & workshops', nameVi: 'Lớp học & Workshop', keywords: ['class', 'workshop', 'course', 'lớp học', 'khóa học'] },
      { slug: 'sports-clubs', name: 'Sports groups & clubs', nameVi: 'Nhóm & CLB thể thao', keywords: ['football', 'running', 'club', 'sports group', 'clb', 'chạy bộ'] },
      { slug: 'lost-found', name: 'Lost & found', nameVi: 'Thất lạc & Tìm thấy', keywords: ['lost', 'found', 'mất', 'thất lạc', 'nhặt được'] },
      { slug: 'volunteers', name: 'Volunteers & causes', nameVi: 'Tình nguyện', keywords: ['volunteer', 'charity', 'cause', 'tình nguyện', 'từ thiện'] },
    ],
    facets: [],
  },

  // 13 ── TICKETS & TRAVEL ──────────────────────────────────────────────────────
  {
    slug: 'tickets-travel',
    name: 'Tickets & Travel',
    nameVi: 'Vé & Du lịch',
    icon: 'Plane',
    color: 'sky',
    description: 'Event tickets, tours & experiences, transport, and visa runs.',
    types: ['sell', 'wanted', 'service'],
    subcategories: [
      { slug: 'event-tickets', name: 'Event tickets', nameVi: 'Vé sự kiện', keywords: ['ticket', 'concert', 'show', 'vé', 'vé sự kiện'] },
      { slug: 'tours', name: 'Tours & experiences', nameVi: 'Tour & Trải nghiệm', keywords: ['tour', 'experience', 'trip', 'du lịch', 'trải nghiệm'] },
      { slug: 'transport', name: 'Transport', nameVi: 'Di chuyển', keywords: ['flight', 'bus', 'train', 'transfer', 'vé máy bay', 'xe khách'] },
      { slug: 'visa-runs', name: 'Visa runs', nameVi: 'Visa run', keywords: ['visa run', 'border run', 'visa run'] },
      { slug: 'vouchers', name: 'Vouchers & deals', nameVi: 'Voucher & Ưu đãi', keywords: ['voucher', 'coupon', 'deal', 'ưu đãi'] },
    ],
    facets: [],
  },

  // 14 ── FOOD & DRINK ──────────────────────────────────────────────────────────
  {
    slug: 'food-drink',
    name: 'Food & Drink',
    nameVi: 'Đồ ăn & Thức uống',
    icon: 'UtensilsCrossed',
    color: 'brand',
    description: 'Home bakers & cooks, imported groceries, meal prep, catering, coffee & tea.',
    types: ['sell', 'service'],
    subcategories: [
      { slug: 'home-baking', name: 'Home baking & cooking', nameVi: 'Bánh & Món nhà làm', keywords: ['baking', 'cake', 'homemade', 'bánh', 'nhà làm'] },
      { slug: 'groceries', name: 'Imported & specialty groceries', nameVi: 'Thực phẩm nhập khẩu', keywords: ['groceries', 'imported', 'cheese', 'thực phẩm', 'nhập khẩu'] },
      { slug: 'meal-prep', name: 'Meal prep & catering', nameVi: 'Suất ăn & Tiệc', keywords: ['meal prep', 'catering', 'tiffin', 'suất ăn', 'đặt tiệc'] },
      { slug: 'coffee-tea', name: 'Coffee & tea', nameVi: 'Cà phê & Trà', keywords: ['coffee', 'tea', 'beans', 'cà phê', 'trà'] },
    ],
    facets: [],
  },
]

// ── Lookups ──────────────────────────────────────────────────────────────────
export const CATEGORY_BY_SLUG: Record<string, CategoryDef> = Object.fromEntries(
  TAXONOMY.map((c) => [c.slug, c]),
)

// Categories where a brand is meaningful (product categories). Client-safe; the
// server-only brand resolver (src/lib/brand.ts) re-exports this same set.
export const BRAND_CATEGORY_SLUGS = [
  'electronics', 'fashion-beauty', 'vehicles', 'rentals', 'furniture-appliances', 'baby-kids', 'hobbies-sports',
] as const
export function categoryHasBrand(slug: string | null | undefined): boolean {
  return !!slug && (BRAND_CATEGORY_SLUGS as readonly string[]).includes(slug)
}

export function subcategoriesFor(categorySlug: string): SubcatDef[] {
  return CATEGORY_BY_SLUG[categorySlug]?.subcategories ?? []
}

// Facets for a category, narrowed to a subcategory when given. A facet with
// `subcats` only shows for those subcategories (e.g. cc engine for motorbikes, L
// for cars); facets without `subcats` always show. Passing no subcategory hides
// subcategory-specific facets (can't know which engine unit applies yet).
export function facetsFor(categorySlug: string, subcategorySlug?: string | null): FacetDef[] {
  const all = CATEGORY_BY_SLUG[categorySlug]?.facets ?? []
  return all.filter((f) => !f.subcats || (!!subcategorySlug && f.subcats.includes(subcategorySlug)))
}

// Range facets (numeric slider + min/max filter) for a category (+subcategory).
export function rangeFacetsFor(categorySlug: string, subcategorySlug?: string | null): (FacetDef & { range: RangeMeta })[] {
  return facetsFor(categorySlug, subcategorySlug).filter((f): f is FacetDef & { range: RangeMeta } => f.kind === 'range' && !!f.range)
}

// Allow-list of columns a `range_<col>` query param may target — guards the API
// from filtering on an arbitrary client-supplied field name.
export const RANGE_COLUMNS: readonly RangeColumn[] = ['year', 'mileageKm', 'engineL', 'engineCc']
export function isRangeColumn(s: string): s is RangeColumn {
  return (RANGE_COLUMNS as readonly string[]).includes(s)
}

export function typesFor(categorySlug: string): ListingType[] {
  return CATEGORY_BY_SLUG[categorySlug]?.types ?? ['sell']
}

// Pick the best subcategory slug for a free-text title (post-wizard auto-suggest
// + mock generation). Returns undefined when nothing matches.
export function suggestSubcategory(categorySlug: string, text: string): string | undefined {
  const subs = subcategoriesFor(categorySlug)
  const hay = (text || '').toLowerCase()
  for (const s of subs) {
    if (s.keywords.some((k) => hay.includes(k.toLowerCase()))) return s.slug
  }
  return undefined
}

// Back-compat shape for the existing SUBCATEGORIES consumers (keyword-matched).
export type SubcatDefLegacy = { slug: string; name: string; nameVi: string; keywords: string[] }
export const SUBCATEGORIES: Record<string, SubcatDefLegacy[]> = Object.fromEntries(
  TAXONOMY.map((c) => [c.slug, c.subcategories]),
)
