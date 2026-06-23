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
export type FacetDef = {
  key: string
  label: string
  labelVi: string
  options: { value: string; label: string; labelVi: string }[]
}

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
  options: [
    { value: 'new', label: 'New / Like new', labelVi: 'Mới / Như mới' },
    { value: 'used', label: 'Used', labelVi: 'Đã dùng' },
  ],
}

export const TAXONOMY: CategoryDef[] = [
  // 1 ── VEHICLES ─────────────────────────────────────────────────────────────
  {
    slug: 'vehicles',
    name: 'Vehicles',
    nameVi: 'Xe cộ',
    icon: 'Bike',
    color: 'sky',
    description: 'Motorbikes to rent or buy, bicycles, cars, e-bikes, parts & gear.',
    types: ['rent', 'sell', 'wanted'],
    subcategories: [
      { slug: 'motorbike-scooter', name: 'Motorbike (Scooter)', nameVi: 'Xe tay ga', keywords: ['scooter', 'vision', 'airblade', 'air blade', 'lead', 'sh', 'vespa', 'xe ga', 'tay ga'] },
      { slug: 'motorbike-manual', name: 'Motorbike (Manual)', nameVi: 'Xe số / Côn tay', keywords: ['manual', 'wave', 'sirius', 'exciter', 'winner', 'xe số', 'côn tay'] },
      { slug: 'bicycle', name: 'Bicycle', nameVi: 'Xe đạp', keywords: ['bicycle', 'bike', 'mountain bike', 'road bike', 'xe đạp'] },
      { slug: 'car', name: 'Car', nameVi: 'Ô tô', keywords: ['car', 'ô tô', 'sedan', 'suv', 'toyota', 'honda civic', 'mazda'] },
      { slug: 'ebike-scooter', name: 'E-bike / Electric scooter', nameVi: 'Xe điện', keywords: ['e-bike', 'ebike', 'electric', 'vinfast', 'xe điện'] },
      { slug: 'parts-gear', name: 'Parts & gear', nameVi: 'Phụ tùng & đồ bảo hộ', keywords: ['helmet', 'parts', 'tire', 'phụ tùng', 'mũ bảo hiểm', 'nón'] },
    ],
    facets: [
      { key: 'transmission', label: 'Transmission', labelVi: 'Hộp số', options: [
        { value: 'automatic', label: 'Automatic', labelVi: 'Xe ga' },
        { value: 'manual', label: 'Manual', labelVi: 'Xe số' },
      ] },
      { key: 'cc', label: 'Engine', labelVi: 'Phân khối', options: [
        { value: '110-125', label: '110–125cc', labelVi: '110–125cc' },
        { value: '150-up', label: '150cc+', labelVi: '150cc+' },
      ] },
      { key: 'brand', label: 'Brand', labelVi: 'Hãng', options: [
        { value: 'honda', label: 'Honda', labelVi: 'Honda' },
        { value: 'yamaha', label: 'Yamaha', labelVi: 'Yamaha' },
        { value: 'vinfast', label: 'VinFast', labelVi: 'VinFast' },
        { value: 'other', label: 'Other', labelVi: 'Khác' },
      ] },
    ],
  },

  // 2 ── PROPERTY ─────────────────────────────────────────────────────────────
  {
    slug: 'property',
    name: 'Property',
    nameVi: 'Nhà ở',
    icon: 'Home',
    color: 'teal',
    description: 'Apartments, houses, rooms, serviced & short-term stays, offices, and property for sale.',
    types: ['rent', 'sell', 'wanted'],
    subcategories: [
      { slug: 'apartment', name: 'Apartment / Condo', nameVi: 'Căn hộ / Chung cư', keywords: ['apartment', 'condo', 'căn hộ', 'chung cư'] },
      { slug: 'house', name: 'House (whole)', nameVi: 'Nhà nguyên căn', keywords: ['house', 'villa', 'townhouse', 'nhà nguyên căn', 'nhà phố', 'biệt thự'] },
      { slug: 'room-shared', name: 'Room / Shared', nameVi: 'Phòng trọ / Ở ghép', keywords: ['room', 'roommate', 'shared', 'phòng trọ', 'ở ghép'] },
      { slug: 'serviced', name: 'Serviced apartment', nameVi: 'Căn hộ dịch vụ', keywords: ['serviced', 'service apartment', 'căn hộ dịch vụ'] },
      { slug: 'short-term', name: 'Short-term / Monthly', nameVi: 'Ngắn hạn / Theo tháng', keywords: ['short term', 'short-term', 'monthly', 'airbnb', 'ngắn hạn', 'theo tháng'] },
      { slug: 'office-retail', name: 'Office & retail', nameVi: 'Văn phòng & Mặt bằng', keywords: ['office', 'retail', 'commercial', 'shop', 'văn phòng', 'mặt bằng'] },
    ],
    facets: [
      { key: 'bedrooms', label: 'Bedrooms', labelVi: 'Phòng ngủ', options: [
        { value: '0', label: 'Studio', labelVi: 'Studio' },
        { value: '1', label: '1 BR', labelVi: '1 PN' },
        { value: '2', label: '2 BR', labelVi: '2 PN' },
        { value: '3', label: '3+ BR', labelVi: '3+ PN' },
      ] },
      { key: 'furnishing', label: 'Furnishing', labelVi: 'Nội thất', options: [
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
      { key: 'brand', label: 'Brand', labelVi: 'Hãng', options: [
        { value: 'apple', label: 'Apple', labelVi: 'Apple' },
        { value: 'samsung', label: 'Samsung', labelVi: 'Samsung' },
        { value: 'sony', label: 'Sony', labelVi: 'Sony' },
        { value: 'other', label: 'Other', labelVi: 'Khác' },
      ] },
      { key: 'warranty', label: 'Warranty', labelVi: 'Bảo hành', options: [
        { value: 'yes', label: 'In warranty', labelVi: 'Còn bảo hành' },
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
      { key: 'gender', label: 'For', labelVi: 'Dành cho', options: [
        { value: 'women', label: 'Women', labelVi: 'Nữ' },
        { value: 'men', label: 'Men', labelVi: 'Nam' },
        { value: 'unisex', label: 'Unisex', labelVi: 'Unisex' },
      ] },
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

export function subcategoriesFor(categorySlug: string): SubcatDef[] {
  return CATEGORY_BY_SLUG[categorySlug]?.subcategories ?? []
}

export function facetsFor(categorySlug: string): FacetDef[] {
  return CATEGORY_BY_SLUG[categorySlug]?.facets ?? []
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
