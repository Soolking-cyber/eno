export type CityId =
  | 'hanoi' | 'halong' | 'ninhbinh' | 'sapa' | 'hagiang' | 'caobang' | 'puluong'
  | 'hue' | 'danang' | 'hoian' | 'phongnha' | 'quynhon' | 'nhatrang' | 'dalat' | 'buonmathuot'
  | 'hochiminh' | 'mekong' | 'cantho' | 'muine' | 'phuquoc' | 'condao'

export type BudgetId = 'smart' | 'comfort' | 'premium'
export type PaceId = 'slow' | 'balanced' | 'full'
export type InterestId = 'food' | 'culture' | 'nature' | 'beaches' | 'adventure' | 'nightlife' | 'wellness' | 'family'
export type AccommodationId = 'hotel' | 'boutique' | 'resort' | 'apartment' | 'homestay' | 'hostel'
export type CabinId = 'economy' | 'premium_economy' | 'business'
export type StopsId = 'direct' | 'one_stop' | 'any'

export type City = {
  id: CityId
  name: string
  nameVi: string
  region: 'north' | 'central' | 'south'
  regionLabel: string
  regionLabelVi: string
  description: string
  descriptionVi: string
  airports: string[]
  recommendedDays: string
  /** Destination CENTRE. Every place filed under this city is validated against it by
   *  isNearCity (src/lib/itinerary-geo.ts), so a wrong value here silently widens the gate
   *  for that whole city rather than for one pin. All 21 are asserted in itinerary-geo.test.ts. */
  lat: number
  lng: number
}

export const CITIES: City[] = [
  { id: 'hanoi', name: 'Hanoi', nameVi: 'Hà Nội', region: 'north', regionLabel: 'Northern Vietnam', regionLabelVi: 'Miền Bắc', description: 'Old Quarter, museums, food, and a strong northern gateway.', descriptionVi: 'Phố Cổ, bảo tàng, ẩm thực và cửa ngõ miền Bắc.', airports: ['HAN'], recommendedDays: '2–4 days', lat: 21.0285, lng: 105.8542 },
  { id: 'halong', name: 'Ha Long & Lan Ha Bay', nameVi: 'Hạ Long & vịnh Lan Hạ', region: 'north', regionLabel: 'Northern Vietnam', regionLabelVi: 'Miền Bắc', description: 'Limestone bays, cruises, kayaking, and island scenery.', descriptionVi: 'Vịnh đá vôi, du thuyền, kayak và phong cảnh đảo.', airports: ['HPH', 'HAN'], recommendedDays: '1–3 days', lat: 20.9101, lng: 107.1839 },
  { id: 'ninhbinh', name: 'Ninh Binh & Tam Coc', nameVi: 'Ninh Bình & Tam Cốc', region: 'north', regionLabel: 'Northern Vietnam', regionLabelVi: 'Miền Bắc', description: 'Karst valleys, river boats, cycling, and temples.', descriptionVi: 'Thung lũng đá vôi, thuyền sông, đạp xe và đền chùa.', airports: ['HAN'], recommendedDays: '2–3 days', lat: 20.2506, lng: 105.9744 },
  { id: 'sapa', name: 'Sa Pa', nameVi: 'Sa Pa', region: 'north', regionLabel: 'Northern Vietnam', regionLabelVi: 'Miền Bắc', description: 'Mountain walks, terraced valleys, and highland communities.', descriptionVi: 'Đi bộ miền núi, ruộng bậc thang và cộng đồng vùng cao.', airports: ['HAN'], recommendedDays: '3–4 days', lat: 22.3364, lng: 103.8438 },
  { id: 'hagiang', name: 'Ha Giang', nameVi: 'Hà Giang', region: 'north', regionLabel: 'Northern Vietnam', regionLabelVi: 'Miền Bắc', description: 'Remote mountain loop with demanding road travel.', descriptionVi: 'Cung đường núi xa, thời gian di chuyển dài.', airports: ['HAN'], recommendedDays: '4–5 days', lat: 22.8233, lng: 104.9836 },
  { id: 'caobang', name: 'Cao Bang', nameVi: 'Cao Bằng', region: 'north', regionLabel: 'Northern Vietnam', regionLabelVi: 'Miền Bắc', description: 'Ban Gioc waterfall, caves, and quieter border landscapes.', descriptionVi: 'Thác Bản Giốc, hang động và cảnh quan biên giới yên tĩnh.', airports: ['HAN'], recommendedDays: '3–4 days', lat: 22.6657, lng: 106.257 },
  { id: 'puluong', name: 'Pu Luong & Mai Chau', nameVi: 'Pù Luông & Mai Châu', region: 'north', regionLabel: 'Northern Vietnam', regionLabelVi: 'Miền Bắc', description: 'Rice terraces, village stays, and gentler trekking.', descriptionVi: 'Ruộng bậc thang, lưu trú bản làng và trekking nhẹ.', airports: ['HAN'], recommendedDays: '2–4 days', lat: 20.55, lng: 105.1 },
  { id: 'hue', name: 'Hue', nameVi: 'Huế', region: 'central', regionLabel: 'Central Vietnam', regionLabelVi: 'Miền Trung', description: 'Imperial history, garden houses, tombs, and refined food.', descriptionVi: 'Di sản cung đình, nhà vườn, lăng tẩm và ẩm thực tinh tế.', airports: ['HUI'], recommendedDays: '2–3 days', lat: 16.4637, lng: 107.5909 },
  { id: 'danang', name: 'Da Nang', nameVi: 'Đà Nẵng', region: 'central', regionLabel: 'Central Vietnam', regionLabelVi: 'Miền Trung', description: 'Beach city, modern food scene, and central transport hub.', descriptionVi: 'Thành phố biển, ẩm thực hiện đại và trung tâm giao thông.', airports: ['DAD'], recommendedDays: '2–4 days', lat: 16.0544, lng: 108.2022 },
  { id: 'hoian', name: 'Hoi An', nameVi: 'Hội An', region: 'central', regionLabel: 'Central Vietnam', regionLabelVi: 'Miền Trung', description: 'Ancient town, villages, crafts, beaches, and cooking.', descriptionVi: 'Phố cổ, làng quê, thủ công, biển và ẩm thực.', airports: ['DAD'], recommendedDays: '2–4 days', lat: 15.8801, lng: 108.338 },
  { id: 'phongnha', name: 'Phong Nha', nameVi: 'Phong Nha', region: 'central', regionLabel: 'Central Vietnam', regionLabelVi: 'Miền Trung', description: 'Caves, jungle, river valleys, and adventure tours.', descriptionVi: 'Hang động, rừng, thung lũng sông và tour phiêu lưu.', airports: ['VDH'], recommendedDays: '2–4 days', lat: 17.5833, lng: 106.2833 },
  { id: 'quynhon', name: 'Quy Nhon', nameVi: 'Quy Nhơn', region: 'central', regionLabel: 'South Central Coast', regionLabelVi: 'Duyên hải Nam Trung Bộ', description: 'Quiet coves, Cham history, and excellent seafood.', descriptionVi: 'Vịnh yên tĩnh, văn hóa Chăm và hải sản ngon.', airports: ['UIH'], recommendedDays: '2–4 days', lat: 13.7829, lng: 109.2196 },
  { id: 'nhatrang', name: 'Nha Trang', nameVi: 'Nha Trang', region: 'central', regionLabel: 'South Central Coast', regionLabelVi: 'Duyên hải Nam Trung Bộ', description: 'Urban beach, islands, diving, and family resorts.', descriptionVi: 'Biển đô thị, đảo, lặn biển và resort gia đình.', airports: ['CXR'], recommendedDays: '2–4 days', lat: 12.2388, lng: 109.1967 },
  { id: 'dalat', name: 'Da Lat', nameVi: 'Đà Lạt', region: 'central', regionLabel: 'Central Highlands', regionLabelVi: 'Tây Nguyên', description: 'Cool weather, gardens, coffee farms, and waterfalls.', descriptionVi: 'Khí hậu mát, vườn hoa, nông trại cà phê và thác.', airports: ['DLI'], recommendedDays: '2–4 days', lat: 11.9404, lng: 108.4583 },
  { id: 'buonmathuot', name: 'Buon Ma Thuot', nameVi: 'Buôn Ma Thuột', region: 'central', regionLabel: 'Central Highlands', regionLabelVi: 'Tây Nguyên', description: 'Coffee culture, waterfalls, and Ede heritage.', descriptionVi: 'Văn hóa cà phê, thác nước và di sản Ê Đê.', airports: ['BMV'], recommendedDays: '2–3 days', lat: 12.6667, lng: 108.05 },
  { id: 'hochiminh', name: 'Ho Chi Minh City', nameVi: 'TP. Hồ Chí Minh', region: 'south', regionLabel: 'Southern Vietnam', regionLabelVi: 'Miền Nam', description: 'Big-city energy, history, food, nightlife, and flight hub.', descriptionVi: 'Nhịp sống đô thị, lịch sử, ẩm thực, về đêm và đầu mối bay.', airports: ['SGN'], recommendedDays: '2–4 days', lat: 10.8231, lng: 106.6297 },
  { id: 'mekong', name: 'Ben Tre & Mekong Delta', nameVi: 'Bến Tre & miền Tây', region: 'south', regionLabel: 'Southern Vietnam', regionLabelVi: 'Miền Nam', description: 'Coconut waterways, cycling, homestays, and river life.', descriptionVi: 'Sông dừa, đạp xe, homestay và đời sống sông nước.', airports: ['SGN', 'VCA'], recommendedDays: '2–3 days', lat: 10.2415, lng: 106.3759 },
  { id: 'cantho', name: 'Can Tho', nameVi: 'Cần Thơ', region: 'south', regionLabel: 'Mekong Delta', regionLabelVi: 'Đồng bằng sông Cửu Long', description: 'Riverfront city and a practical Mekong transport base.', descriptionVi: 'Thành phố ven sông và điểm trung chuyển miền Tây.', airports: ['VCA'], recommendedDays: '1–3 days', lat: 10.0452, lng: 105.7469 },
  { id: 'muine', name: 'Mui Ne & Phan Thiet', nameVi: 'Mũi Né & Phan Thiết', region: 'south', regionLabel: 'South Central Coast', regionLabelVi: 'Duyên hải Nam Trung Bộ', description: 'Dunes, kitesurfing, fishing villages, and resort coast.', descriptionVi: 'Đồi cát, lướt ván diều, làng chài và bờ biển resort.', airports: ['SGN'], recommendedDays: '2–4 days', lat: 10.933, lng: 108.287 },
  { id: 'phuquoc', name: 'Phu Quoc', nameVi: 'Phú Quốc', region: 'south', regionLabel: 'Southern Islands', regionLabelVi: 'Hải đảo phía Nam', description: 'Beaches, seafood, island roads, and resorts.', descriptionVi: 'Biển, hải sản, cung đường đảo và resort.', airports: ['PQC'], recommendedDays: '3–5 days', lat: 10.2899, lng: 103.984 },
  { id: 'condao', name: 'Con Dao', nameVi: 'Côn Đảo', region: 'south', regionLabel: 'Southern Islands', regionLabelVi: 'Hải đảo phía Nam', description: 'Protected coast, history, diving, and limited flights.', descriptionVi: 'Bờ biển được bảo tồn, lịch sử, lặn biển và chuyến bay hạn chế.', airports: ['VCS'], recommendedDays: '3–5 days', lat: 8.6833, lng: 106.6 },
]

export const CITY_MAP = new Map(CITIES.map((city) => [city.id, city]))

export const BUDGETS = [
  { id: 'smart' as const, label: 'Smart', labelVi: 'Tiết kiệm', daily: 1_200_000, detail: 'Up to ₫1.2m/day', detailVi: 'Tối đa 1,2 triệu/ngày' },
  { id: 'comfort' as const, label: 'Comfort', labelVi: 'Thoải mái', daily: 2_500_000, detail: 'Around ₫2.5m/day', detailVi: 'Khoảng 2,5 triệu/ngày' },
  { id: 'premium' as const, label: 'Premium', labelVi: 'Cao cấp', daily: 5_000_000, detail: 'From ₫5m/day', detailVi: 'Từ 5 triệu/ngày' },
]

export type ActivityPlan = {
  time: string
  title: string
  place: string
  details: string
  travelMinutes: number
  estimatedCostVnd: number
  bookingAdvice: string
}

export type GeneratedPlan = {
  title: string
  summary: string
  routeSummary: string
  routeRationale: string
  budget: {
    perTravelerLowVnd: number
    perTravelerHighVnd: number
    groupLowVnd: number
    groupHighVnd: number
    flightsIncluded: boolean
    note: string
  }
  routeLegs: Array<{ from: string; to: string; mode: string; duration: string; advice: string }>
  flights: Array<{
    direction: 'outbound' | 'return' | 'domestic'
    label: string
    route: string
    airlines: string[]
    date: string
    departureWindow: string
    duration: string
    stops: number
    priceLowVnd: number
    priceHighVnd: number
    fareNote: string
    url: string
  }>
  stays: Array<{
    city: string
    name: string
    area: string
    category: string
    why: string
    nightlyLowVnd: number
    nightlyHighVnd: number
    url: string
  }>
  days: Array<{
    dayNumber: number
    date: string
    city: string
    title: string
    focus: string
    paceNote: string
    morning: ActivityPlan
    afternoon: ActivityPlan
    evening: ActivityPlan
    foodNote: string
    estimatedDailyCostVnd: number
  }>
  practical: { arrival: string; localTransport: string; connectivity: string; money: string; weather: string; safety: string }
  bookingChecklist: Array<{ when: string; item: string; reason: string }>
  assumptions: string[]
}

export type GeneratedItineraryResponse = {
  plan: GeneratedPlan
  model: string
  generatedAt: string
  sources: Array<{ title: string; url: string; domain: string }>
  searchQueries: string[]
  /** eno.vn only: the generate route saves the finished plan server-side
   *  (cookie session) and returns the row id; null when that save failed. */
  savedItineraryId?: string | null
}

// NOTE (eno.vn port): the forum's compact `formatVnd` ("₫2.5m") was intentionally
// NOT ported — money rendering goes through src/lib/vnd.ts (formatMoneyFull) per
// the app-wide money canon (full grouped amounts, locale-aware separators).

export function addDays(date: string, amount: number): string {
  if (!date) return ''
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}
