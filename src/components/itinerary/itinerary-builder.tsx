'use client'

import { useMemo, useRef, useState } from 'react'
import {
  BedDouble,
  CalendarDays,
  Check,
  Clock3,
  Coffee,
  Compass,
  Hotel,
  Landmark,
  Loader2,
  Map,
  MapPin,
  MapPinned,
  MoonStar,
  Navigation,
  RefreshCw,
  Route,
  Sparkles,
  Sun,
  TreePine,
  UtensilsCrossed,
  WalletCards,
  Waves,
} from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

type DestinationId = 'north' | 'central' | 'south' | 'island'
type BudgetId = 'smart' | 'comfort' | 'premium'
type InterestId = 'food' | 'culture' | 'nature' | 'beaches'

type DayTemplate = {
  area: string
  areaVi: string
  title: string
  titleVi: string
  morning: string
  morningVi: string
  afternoon: string
  afternoonVi: string
  evening: string
  eveningVi: string
}

type Destination = {
  id: DestinationId
  label: string
  labelVi: string
  shortLabel: string
  shortLabelVi: string
  description: string
  descriptionVi: string
  route: string
  routeVi: string
  days: DayTemplate[]
  stays: { name: string; nameVi: string; area: string; areaVi: string; note: string; noteVi: string }[]
}

const DESTINATIONS: Destination[] = [
  {
    id: 'north',
    label: 'Hanoi & Northern Vietnam',
    labelVi: 'Hà Nội & miền Bắc',
    shortLabel: 'Northern Vietnam',
    shortLabelVi: 'Miền Bắc Việt Nam',
    description: 'Old streets, limestone landscapes, and mountain culture.',
    descriptionVi: 'Phố cổ, núi đá vôi và văn hóa vùng cao.',
    route: 'Hanoi → Ninh Binh → Ha Long',
    routeVi: 'Hà Nội → Ninh Bình → Hạ Long',
    days: [
      { area: 'Hanoi', areaVi: 'Hà Nội', title: 'Old Quarter arrival', titleVi: 'Đến Phố Cổ', morning: 'Settle in and walk around Hoan Kiem Lake', morningVi: 'Nhận phòng và dạo quanh Hồ Hoàn Kiếm', afternoon: 'Explore the Old Quarter craft streets', afternoonVi: 'Khám phá các phố nghề trong Phố Cổ', evening: 'Street-food tasting around Ta Hien', eveningVi: 'Thưởng thức ẩm thực đường phố quanh Tạ Hiện' },
      { area: 'Hanoi', areaVi: 'Hà Nội', title: 'Culture and local flavors', titleVi: 'Văn hóa và hương vị địa phương', morning: 'Temple of Literature before the crowds', morningVi: 'Văn Miếu trước giờ đông khách', afternoon: 'Vietnamese coffee workshop and museum time', afternoonVi: 'Trải nghiệm cà phê Việt và tham quan bảo tàng', evening: 'Water puppet show and a relaxed dinner', eveningVi: 'Xem múa rối nước và dùng bữa tối thư thả' },
      { area: 'Ninh Binh', areaVi: 'Ninh Bình', title: 'Limestone country', titleVi: 'Miền núi đá vôi', morning: 'Early transfer through the Red River Delta', morningVi: 'Di chuyển sớm qua đồng bằng sông Hồng', afternoon: 'Trang An boat route between the karsts', afternoonVi: 'Đi thuyền Tràng An giữa núi đá vôi', evening: 'Quiet homestay dinner in Tam Coc', eveningVi: 'Ăn tối yên tĩnh tại homestay ở Tam Cốc' },
      { area: 'Ninh Binh', areaVi: 'Ninh Bình', title: 'Rice fields and viewpoints', titleVi: 'Đồng lúa và điểm ngắm cảnh', morning: 'Cycle the lanes around Bich Dong', morningVi: 'Đạp xe quanh những con đường Bích Động', afternoon: 'Climb Hang Mua for the valley view', afternoonVi: 'Leo Hang Múa ngắm toàn cảnh thung lũng', evening: 'Return to Hanoi with a free evening', eveningVi: 'Trở lại Hà Nội và tự do buổi tối' },
      { area: 'Ha Long Bay', areaVi: 'Vịnh Hạ Long', title: 'A day on the bay', titleVi: 'Một ngày trên vịnh', morning: 'Transfer to the harbor and board the boat', morningVi: 'Di chuyển ra bến cảng và lên thuyền', afternoon: 'Kayak a quiet cove and visit a cave', afternoonVi: 'Chèo kayak ở vịnh nhỏ và tham quan hang động', evening: 'Sunset on deck and dinner by the water', eveningVi: 'Ngắm hoàng hôn trên boong và ăn tối bên vịnh' },
      { area: 'Hanoi', areaVi: 'Hà Nội', title: 'A slower final day', titleVi: 'Ngày cuối thong thả', morning: 'Brunch in the French Quarter', morningVi: 'Ăn brunch ở khu phố Pháp', afternoon: 'Shop for crafts and last-minute gifts', afternoonVi: 'Mua đồ thủ công và quà trước khi về', evening: 'Rooftop farewell drink over the city', eveningVi: 'Đồ uống chia tay trên rooftop nhìn toàn thành phố' },
      { area: 'Hanoi', areaVi: 'Hà Nội', title: 'Hidden corners of the capital', titleVi: 'Những góc nhỏ của thủ đô', morning: 'Walk the rail-side neighborhoods with a local guide', morningVi: 'Dạo khu dân cư ven đường sắt cùng hướng dẫn viên địa phương', afternoon: 'Browse independent galleries and design shops', afternoonVi: 'Tham quan gallery độc lập và cửa hàng thiết kế', evening: 'Choose a neighborhood restaurant away from the center', eveningVi: 'Chọn một quán ăn khu dân cư xa trung tâm' },
    ],
    stays: [
      { name: 'Old Quarter social stay', nameVi: 'Nhà nghỉ giao lưu Phố Cổ', area: 'Hoan Kiem', areaVi: 'Hoàn Kiếm', note: 'Walkable and lively', noteVi: 'Dễ đi bộ, không khí sôi động' },
      { name: 'Lakeside boutique hotel', nameVi: 'Khách sạn boutique ven hồ', area: 'French Quarter', areaVi: 'Khu phố Pháp', note: 'Quiet rooms near the center', noteVi: 'Phòng yên tĩnh gần trung tâm' },
      { name: 'West Lake serviced suite', nameVi: 'Căn hộ dịch vụ Hồ Tây', area: 'Tay Ho', areaVi: 'Tây Hồ', note: 'More space and a slower pace', noteVi: 'Rộng rãi và nhịp sống thư thả' },
    ],
  },
  {
    id: 'central',
    label: 'Da Nang, Hoi An & Hue',
    labelVi: 'Đà Nẵng, Hội An & Huế',
    shortLabel: 'Central Vietnam',
    shortLabelVi: 'Miền Trung Việt Nam',
    description: 'Beaches, lantern streets, imperial history, and brilliant food.',
    descriptionVi: 'Biển, phố đèn lồng, lịch sử cố đô và ẩm thực đặc sắc.',
    route: 'Da Nang → Hoi An → Hue',
    routeVi: 'Đà Nẵng → Hội An → Huế',
    days: [
      { area: 'Da Nang', areaVi: 'Đà Nẵng', title: 'Beach-city arrival', titleVi: 'Đến thành phố biển', morning: 'Check in and reset after your journey', morningVi: 'Nhận phòng và nghỉ ngơi sau hành trình', afternoon: 'Swim at My Khe and walk the beachfront', afternoonVi: 'Tắm biển Mỹ Khê và dạo bờ biển', evening: 'Seafood dinner beside the Han River', eveningVi: 'Ăn tối hải sản bên sông Hàn' },
      { area: 'Da Nang', areaVi: 'Đà Nẵng', title: 'Views from Son Tra', titleVi: 'Ngắm cảnh từ Sơn Trà', morning: 'Ride up Son Tra Peninsula before it gets hot', morningVi: 'Lên bán đảo Sơn Trà trước khi trời nóng', afternoon: 'Visit the Cham Sculpture Museum', afternoonVi: 'Tham quan Bảo tàng Điêu khắc Chăm', evening: 'See the bridges light up after dark', eveningVi: 'Ngắm những cây cầu lên đèn khi tối' },
      { area: 'Hoi An', areaVi: 'Hội An', title: 'Lantern town', titleVi: 'Phố đèn lồng', morning: 'Transfer to Hoi An via the Marble Mountains', morningVi: 'Đến Hội An qua Ngũ Hành Sơn', afternoon: 'Walk the old houses and riverside lanes', afternoonVi: 'Dạo nhà cổ và những con đường ven sông', evening: 'Lantern-lit dinner in the Ancient Town', eveningVi: 'Ăn tối dưới ánh đèn lồng trong Phố Cổ' },
      { area: 'Hoi An', areaVi: 'Hội An', title: 'Village life and cooking', titleVi: 'Làng quê và ẩm thực', morning: 'Cycle through Tra Que vegetable village', morningVi: 'Đạp xe qua làng rau Trà Quế', afternoon: 'Hands-on Central Vietnamese cooking class', afternoonVi: 'Lớp nấu món miền Trung thực hành', evening: 'Free time for tailor fittings or cafes', eveningVi: 'Tự do thử đồ may hoặc ngồi cà phê' },
      { area: 'Hue', areaVi: 'Huế', title: 'Across the Hai Van Pass', titleVi: 'Qua đèo Hải Vân', morning: 'Scenic transfer over the Hai Van Pass', morningVi: 'Di chuyển ngắm cảnh qua đèo Hải Vân', afternoon: 'Explore the Imperial City at an easy pace', afternoonVi: 'Tham quan Đại Nội với nhịp độ thư thả', evening: 'Try Hue specialties near the Perfume River', eveningVi: 'Thử đặc sản Huế gần sông Hương' },
      { area: 'Hue', areaVi: 'Huế', title: 'Tombs, gardens, and tea', titleVi: 'Lăng tẩm, vườn và trà', morning: 'Visit a royal tomb before the tour groups', morningVi: 'Thăm lăng vua trước giờ đông đoàn khách', afternoon: 'Garden-house tea and a riverside pause', afternoonVi: 'Uống trà nhà vườn và nghỉ bên sông', evening: 'Sunset boat ride on the Perfume River', eveningVi: 'Đi thuyền ngắm hoàng hôn trên sông Hương' },
      { area: 'Da Nang', areaVi: 'Đà Nẵng', title: 'Easy departure day', titleVi: 'Ngày khởi hành nhẹ nhàng', morning: 'Return to Da Nang and stop for local coffee', morningVi: 'Trở lại Đà Nẵng và ghé uống cà phê', afternoon: 'Last swim or market visit before departure', afternoonVi: 'Tắm biển lần cuối hoặc đi chợ trước khi về', evening: 'Depart with time kept deliberately flexible', eveningVi: 'Khởi hành với lịch trình được để linh hoạt' },
    ],
    stays: [
      { name: 'My Khe beach guesthouse', nameVi: 'Nhà nghỉ biển Mỹ Khê', area: 'Da Nang', areaVi: 'Đà Nẵng', note: 'Simple stay close to the sand', noteVi: 'Chỗ ở đơn giản gần biển' },
      { name: 'Hoi An garden boutique', nameVi: 'Khách sạn boutique sân vườn Hội An', area: 'Cam Chau', areaVi: 'Cẩm Châu', note: 'Pool, bicycles, and old-town access', noteVi: 'Có hồ bơi, xe đạp và gần Phố Cổ' },
      { name: 'Hue riverside heritage stay', nameVi: 'Khu nghỉ di sản ven sông Huế', area: 'Perfume River', areaVi: 'Sông Hương', note: 'Calm setting with local character', noteVi: 'Không gian yên tĩnh, đậm nét địa phương' },
    ],
  },
  {
    id: 'south',
    label: 'Ho Chi Minh City & the South',
    labelVi: 'TP. Hồ Chí Minh & miền Nam',
    shortLabel: 'Southern Vietnam',
    shortLabelVi: 'Miền Nam Việt Nam',
    description: 'Fast city energy, river life, markets, and coffee culture.',
    descriptionVi: 'Nhịp sống sôi động, miền sông nước, chợ và văn hóa cà phê.',
    route: 'Ho Chi Minh City → Mekong Delta',
    routeVi: 'TP. Hồ Chí Minh → Đồng bằng sông Cửu Long',
    days: [
      { area: 'Ho Chi Minh City', areaVi: 'TP. Hồ Chí Minh', title: 'Saigon first impressions', titleVi: 'Ấn tượng đầu tiên về Sài Gòn', morning: 'Arrive, check in, and find your bearings', morningVi: 'Đến nơi, nhận phòng và làm quen khu vực', afternoon: 'Walk the central architecture loop', afternoonVi: 'Dạo vòng kiến trúc khu trung tâm', evening: 'Rooftop views and a street-food dinner', eveningVi: 'Ngắm cảnh rooftop và ăn tối đường phố' },
      { area: 'Ho Chi Minh City', areaVi: 'TP. Hồ Chí Minh', title: 'Markets and modern Saigon', titleVi: 'Chợ và Sài Gòn hiện đại', morning: 'Breakfast in a neighborhood market', morningVi: 'Ăn sáng tại một khu chợ địa phương', afternoon: 'Explore Cho Lon temples and medicine streets', afternoonVi: 'Khám phá chùa và phố thuốc ở Chợ Lớn', evening: 'Live music or a hidden cocktail bar', eveningVi: 'Nghe nhạc sống hoặc ghé quán cocktail ẩn' },
      { area: 'Cu Chi', areaVi: 'Củ Chi', title: 'History beyond the center', titleVi: 'Lịch sử ngoài trung tâm', morning: 'Early trip to the Cu Chi countryside', morningVi: 'Đi sớm về vùng quê Củ Chi', afternoon: 'Return for a slow lunch and museum visit', afternoonVi: 'Trở lại dùng bữa trưa và tham quan bảo tàng', evening: 'Cafe hopping around District 3', eveningVi: 'Khám phá cà phê quanh Quận 3' },
      { area: 'Ben Tre', areaVi: 'Bến Tre', title: 'Mekong river rhythms', titleVi: 'Nhịp sống sông nước miền Tây', morning: 'Drive south and board a small river boat', morningVi: 'Đi về phía Nam và lên thuyền nhỏ', afternoon: 'Cycle quiet lanes between coconut gardens', afternoonVi: 'Đạp xe trên đường làng giữa vườn dừa', evening: 'Family-style dinner at a garden homestay', eveningVi: 'Ăn tối kiểu gia đình tại homestay sân vườn' },
      { area: 'Ben Tre', areaVi: 'Bến Tre', title: 'A slower delta morning', titleVi: 'Buổi sáng miền Tây thong thả', morning: 'Visit a local workshop and riverside market', morningVi: 'Thăm xưởng địa phương và chợ ven sông', afternoon: 'Return to Saigon with time to reset', afternoonVi: 'Trở về Sài Gòn và nghỉ ngơi', evening: 'Choose a final dinner in your favorite district', eveningVi: 'Chọn bữa tối cuối ở khu phố yêu thích' },
      { area: 'Ho Chi Minh City', areaVi: 'TP. Hồ Chí Minh', title: 'Creative neighborhoods', titleVi: 'Những khu phố sáng tạo', morning: 'Browse independent shops and small galleries', morningVi: 'Dạo cửa hàng độc lập và gallery nhỏ', afternoon: 'Cross the river for a different skyline view', afternoonVi: 'Qua sông ngắm đường chân trời từ góc khác', evening: 'Casual dinner with a local craft drink', eveningVi: 'Ăn tối nhẹ cùng đồ uống thủ công địa phương' },
      { area: 'Ho Chi Minh City', areaVi: 'TP. Hồ Chí Minh', title: 'Flexible farewell day', titleVi: 'Ngày chia tay linh hoạt', morning: 'Vietnamese coffee and an unhurried brunch', morningVi: 'Cà phê Việt và brunch thong thả', afternoon: 'Pick up gifts and leave room for traffic', afternoonVi: 'Mua quà và dành thời gian dự phòng kẹt xe', evening: 'Depart or add one more night in the city', eveningVi: 'Khởi hành hoặc ở thêm một đêm trong thành phố' },
    ],
    stays: [
      { name: 'Central Saigon smart stay', nameVi: 'Chỗ nghỉ tiết kiệm trung tâm Sài Gòn', area: 'District 1', areaVi: 'Quận 1', note: 'Compact rooms near the main sights', noteVi: 'Phòng gọn gần các điểm tham quan' },
      { name: 'District 3 design hotel', nameVi: 'Khách sạn thiết kế Quận 3', area: 'District 3', areaVi: 'Quận 3', note: 'Leafy streets and strong cafe options', noteVi: 'Đường xanh mát và nhiều quán cà phê' },
      { name: 'Riverside serviced residence', nameVi: 'Căn hộ dịch vụ ven sông', area: 'Thu Thiem', areaVi: 'Thủ Thiêm', note: 'More space with skyline views', noteVi: 'Rộng rãi, có tầm nhìn thành phố' },
    ],
  },
  {
    id: 'island',
    label: 'Phu Quoc island escape',
    labelVi: 'Kỳ nghỉ đảo Phú Quốc',
    shortLabel: 'Phu Quoc',
    shortLabelVi: 'Phú Quốc',
    description: 'Beach time, island roads, seafood, and room to slow down.',
    descriptionVi: 'Biển, cung đường đảo, hải sản và thời gian thư giãn.',
    route: 'Duong Dong → Southern Islands → North Coast',
    routeVi: 'Dương Đông → Nam đảo → Bắc đảo',
    days: [
      { area: 'Duong Dong', areaVi: 'Dương Đông', title: 'Land softly on the island', titleVi: 'Khởi đầu nhẹ nhàng trên đảo', morning: 'Arrive and settle into island time', morningVi: 'Đến nơi và bắt đầu nhịp sống trên đảo', afternoon: 'First swim and a long beach walk', afternoonVi: 'Tắm biển và đi bộ dài trên bãi biển', evening: 'Night-market seafood tasting', eveningVi: 'Thưởng thức hải sản ở chợ đêm' },
      { area: 'South Island', areaVi: 'Nam đảo', title: 'Clear water and small islands', titleVi: 'Nước trong và đảo nhỏ', morning: 'Boat out early before the busiest departures', morningVi: 'Đi thuyền sớm trước giờ đông khách', afternoon: 'Snorkel and pause on a quiet beach', afternoonVi: 'Lặn ngắm san hô và nghỉ trên bãi biển yên tĩnh', evening: 'Sunset dinner back on the main island', eveningVi: 'Ăn tối ngắm hoàng hôn trên đảo chính' },
      { area: 'South Island', areaVi: 'Nam đảo', title: 'Island roads and local stories', titleVi: 'Đường đảo và câu chuyện địa phương', morning: 'Ride between pepper farms and fishing villages', morningVi: 'Đi qua vườn tiêu và làng chài', afternoon: 'Choose a sheltered beach for a slow swim', afternoonVi: 'Chọn bãi biển kín gió để tắm thư thả', evening: 'Fresh catch at a family-run restaurant', eveningVi: 'Hải sản tươi tại quán ăn gia đình' },
      { area: 'North Coast', areaVi: 'Bắc đảo', title: 'The quieter north coast', titleVi: 'Bờ biển phía Bắc yên tĩnh', morning: 'Drive north through forested roads', morningVi: 'Đi về phía Bắc qua những cung đường rừng', afternoon: 'Beach time with almost nothing scheduled', afternoonVi: 'Thư giãn trên biển với lịch trình tối giản', evening: 'Return before dark for a relaxed meal', eveningVi: 'Trở về trước khi tối và dùng bữa thư thả' },
      { area: 'Duong Dong', areaVi: 'Dương Đông', title: 'A reset day', titleVi: 'Một ngày tái tạo năng lượng', morning: 'Sleep in, brunch, and book a massage', morningVi: 'Ngủ nướng, ăn brunch và massage', afternoon: 'Cafe time or one final swim', afternoonVi: 'Ngồi cà phê hoặc tắm biển lần cuối', evening: 'Sunset drink at the waterline', eveningVi: 'Uống nước ngắm hoàng hôn sát bờ biển' },
      { area: 'East Coast', areaVi: 'Bờ Đông', title: 'A different side of the island', titleVi: 'Một góc khác của đảo', morning: 'Follow the quieter road toward Ham Ninh', morningVi: 'Theo cung đường yên tĩnh về Hàm Ninh', afternoon: 'Long seafood lunch and coastal wandering', afternoonVi: 'Ăn trưa hải sản và dạo bờ biển', evening: 'Free evening near your hotel', eveningVi: 'Buổi tối tự do gần khách sạn' },
      { area: 'Duong Dong', areaVi: 'Dương Đông', title: 'Easy island departure', titleVi: 'Rời đảo thật nhẹ nhàng', morning: 'Coffee, packing, and one last beach walk', morningVi: 'Uống cà phê, thu xếp hành lý và dạo biển lần cuối', afternoon: 'Transfer with a comfortable airport buffer', afternoonVi: 'Di chuyển ra sân bay với thời gian dự phòng', evening: 'Continue home or onward through Vietnam', eveningVi: 'Về nhà hoặc tiếp tục hành trình ở Việt Nam' },
    ],
    stays: [
      { name: 'Duong Dong beach guesthouse', nameVi: 'Nhà nghỉ biển Dương Đông', area: 'Duong Dong', areaVi: 'Dương Đông', note: 'Easy access to town and the night market', noteVi: 'Dễ vào thị trấn và chợ đêm' },
      { name: 'Garden pool resort', nameVi: 'Khu nghỉ dưỡng hồ bơi sân vườn', area: 'Long Beach', areaVi: 'Bãi Trường', note: 'A balanced base for island day trips', noteVi: 'Vị trí cân bằng cho các chuyến đi trong ngày' },
      { name: 'Quiet north-coast retreat', nameVi: 'Khu nghỉ yên tĩnh Bắc đảo', area: 'Ganh Dau', areaVi: 'Gành Dầu', note: 'More privacy and unhurried beach time', noteVi: 'Riêng tư hơn và thư giãn bên biển' },
    ],
  },
]

const BUDGETS = [
  { id: 'smart' as const, label: 'Smart', labelVi: 'Tiết kiệm', daily: 1_200_000, range: 'Up to ₫1.2m/day', rangeVi: 'Tối đa 1,2 triệu/ngày', hotel: 'Simple, well-located stays', hotelVi: 'Chỗ ở đơn giản, vị trí thuận tiện' },
  { id: 'comfort' as const, label: 'Comfort', labelVi: 'Thoải mái', daily: 2_500_000, range: 'Around ₫2.5m/day', rangeVi: 'Khoảng 2,5 triệu/ngày', hotel: 'Boutique hotels with breakfast', hotelVi: 'Khách sạn boutique có bữa sáng' },
  { id: 'premium' as const, label: 'Premium', labelVi: 'Cao cấp', daily: 5_000_000, range: 'From ₫5m/day', rangeVi: 'Từ 5 triệu/ngày', hotel: 'Design stays and private transfers', hotelVi: 'Chỗ nghỉ thiết kế và xe đưa đón riêng' },
]

const INTERESTS: { id: InterestId; label: string; labelVi: string; Icon: typeof UtensilsCrossed }[] = [
  { id: 'food', label: 'Food', labelVi: 'Ẩm thực', Icon: UtensilsCrossed },
  { id: 'culture', label: 'Culture', labelVi: 'Văn hóa', Icon: Landmark },
  { id: 'nature', label: 'Nature', labelVi: 'Thiên nhiên', Icon: TreePine },
  { id: 'beaches', label: 'Beaches', labelVi: 'Biển', Icon: Waves },
]

function formatVnd(amount: number): string {
  const millions = amount / 1_000_000
  return `₫${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}m`
}

function PlannerLoading() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Card className="gap-3 p-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </Card>
      {[1, 2, 3].map((item) => (
        <Card key={item} className="gap-3 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </Card>
      ))}
    </div>
  )
}

export function ItineraryBuilder() {
  const { tr } = useLanguage()
  const [destinationId, setDestinationId] = useState<DestinationId>('central')
  const [days, setDays] = useState(5)
  const [budgetId, setBudgetId] = useState<BudgetId>('comfort')
  const [interests, setInterests] = useState<Set<InterestId>>(() => new Set(['food', 'culture']))
  const [state, setState] = useState<'empty' | 'building' | 'ready'>('empty')
  const resultRef = useRef<HTMLDivElement>(null)

  const destination = DESTINATIONS.find((item) => item.id === destinationId) || DESTINATIONS[0]
  const budget = BUDGETS.find((item) => item.id === budgetId) || BUDGETS[1]
  const tripDays = useMemo(() => destination.days.slice(0, days), [destination, days])
  const estimatedBudget = budget.daily * days

  const toggleInterest = (id: InterestId) => {
    setInterests((current) => {
      const next = new Set(current)
      if (next.has(id) && next.size > 1) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const buildPlan = () => {
    setState('building')
    window.setTimeout(() => {
      setState('ready')
      window.requestAnimationFrame(() => resultRef.current?.focus())
    }, 700)
  }

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <section className="relative overflow-hidden rounded-3xl bg-brand-deep px-5 py-8 text-white sm:px-8 sm:py-10 lg:px-10">
        <div className="relative z-10 max-w-2xl">
          <Badge variant="brand" size="sm" className="bg-white/10 text-white">
            <Sparkles className="h-3.5 w-3.5" />
            {tr('AI trip planner preview', 'Bản xem trước lập kế hoạch AI')}
          </Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {tr('Your Vietnam trip, planned in minutes.', 'Chuyến đi Việt Nam của bạn, lên kế hoạch trong vài phút.')}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
            {tr('Choose where you are going, how long you have, and what you want to spend. We will shape the days around you.', 'Chọn nơi bạn muốn đến, thời gian và ngân sách. Chúng tôi sẽ sắp xếp từng ngày phù hợp với bạn.')}
          </p>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/80 sm:text-sm">
            <span className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-white" />{tr('Day-by-day route', 'Lộ trình từng ngày')}</span>
            <span className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-white" />{tr('Stay suggestions', 'Gợi ý chỗ ở')}</span>
            <span className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-white" />{tr('Budget-aware ideas', 'Gợi ý theo ngân sách')}</span>
          </div>
        </div>
        <Route className="pointer-events-none absolute -bottom-12 -right-8 h-56 w-56 rotate-12 text-white/5 sm:h-72 sm:w-72" aria-hidden="true" />
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="gap-0 overflow-visible p-5 sm:p-6 lg:sticky lg:top-24">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <MapPinned className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-foreground">{tr('Shape your trip', 'Thiết kế chuyến đi')}</h2>
              <p className="mt-1 text-xs leading-relaxed text-body">{tr('You can change everything and build again.', 'Bạn có thể thay đổi mọi lựa chọn và tạo lại.')}</p>
            </div>
          </div>

          <div className="mt-6 space-y-6">
            <Field>
              <FieldLabel id="itinerary-destination-label">{tr('Where do you want to explore?', 'Bạn muốn khám phá nơi nào?')}</FieldLabel>
              <Select value={destinationId} onValueChange={(value) => { if (typeof value === 'string') setDestinationId(value as DestinationId) }}>
                <SelectTrigger aria-labelledby="itinerary-destination-label" className="h-12 w-full cursor-pointer rounded-xl border-line-strong bg-card px-3.5">
                  <MapPin className="h-4 w-4 text-accent-foreground" />
                  <SelectValue>{tr(destination.label, destination.labelVi)}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" className="min-w-[min(23rem,calc(100vw-2rem))]">
                  {DESTINATIONS.map((item) => (
                    <SelectItem key={item.id} value={item.id} className="py-2">
                      <span className="flex flex-col items-start gap-0.5">
                        <span className="font-semibold">{tr(item.label, item.labelVi)}</span>
                        <span className="text-xs text-body">{tr(item.description, item.descriptionVi)}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{tr(destination.description, destination.descriptionVi)}</FieldDescription>
            </Field>

            <div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p id="itinerary-days-label" className="text-sm font-medium text-foreground">{tr('How many days?', 'Bạn đi bao nhiêu ngày?')}</p>
                  <p className="mt-1 text-xs text-body">{tr('A focused route without rushing.', 'Lộ trình vừa đủ, không vội vàng.')}</p>
                </div>
                <span className="flex h-10 min-w-20 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-bold text-accent-foreground">
                  <CalendarDays className="h-4 w-4" />
                  {days} {tr('days', 'ngày')}
                </span>
              </div>
              <Slider
                value={days}
                min={3}
                max={7}
                onChange={setDays}
                aria-label={tr('Trip length in days', 'Số ngày của chuyến đi')}
                className="mt-4"
              />
              <div className="mt-1 flex justify-between text-2xs font-medium text-ink-4">
                <span>{tr('3 days', '3 ngày')}</span>
                <span>{tr('7 days', '7 ngày')}</span>
              </div>
            </div>

            <div>
              <p id="itinerary-budget-label" className="text-sm font-medium text-foreground">{tr('Budget per traveler', 'Ngân sách mỗi người')}</p>
              <p className="mt-1 text-xs text-body">{tr('A daily guide including stays, food, and activities.', 'Ước tính mỗi ngày gồm chỗ ở, ăn uống và hoạt động.')}</p>
              <RadioGroup
                value={budgetId}
                onValueChange={(value) => setBudgetId(value as BudgetId)}
                aria-labelledby="itinerary-budget-label"
                className="mt-3 grid gap-2"
              >
                {BUDGETS.map((item) => {
                  const selected = budgetId === item.id
                  return (
                    <Radio
                      key={item.id}
                      value={item.id}
                      className={cn(
                        'w-full justify-start rounded-xl border px-3.5 py-3 text-left transition-colors',
                        selected ? 'border-brand bg-accent text-accent-foreground' : 'border-border bg-card text-body hover:border-line-strong hover:bg-tint',
                      )}
                    >
                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-brand bg-primary text-white' : 'border-line-strong bg-card')}>
                        {selected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-foreground">{tr(item.label, item.labelVi)}</span>
                        <span className="mt-0.5 block text-xs">{tr(item.range, item.rangeVi)}</span>
                      </span>
                    </Radio>
                  )
                })}
              </RadioGroup>
            </div>

            <div>
              <p id="itinerary-interests-label" className="text-sm font-medium text-foreground">{tr('What do you enjoy?', 'Bạn thích điều gì?')}</p>
              <div role="group" aria-labelledby="itinerary-interests-label" className="mt-3 flex flex-wrap gap-2">
                {INTERESTS.map(({ id, label, labelVi, Icon }) => {
                  const selected = interests.has(id)
                  return (
                    <Button
                      key={id}
                      type="button"
                      variant="bare"
                      size="none"
                      aria-pressed={selected}
                      onClick={() => toggleInterest(id)}
                      className={cn(
                        'gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors',
                        selected ? 'border-brand bg-primary text-white' : 'border-border bg-card text-body hover:bg-tint',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tr(label, labelVi)}
                    </Button>
                  )
                })}
              </div>
            </div>
          </div>

          <Button
            data-testid="build-itinerary"
            type="button"
            variant="cta"
            size="lg"
            className="mt-7 w-full"
            onClick={buildPlan}
            disabled={state === 'building'}
          >
            {state === 'building' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'ready' ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {state === 'building' ? tr('Building your trip…', 'Đang tạo chuyến đi…') : state === 'ready' ? tr('Build a new version', 'Tạo phiên bản mới') : tr('Build my itinerary', 'Tạo lịch trình cho tôi')}
          </Button>
          <p className="mt-3 text-center text-2xs leading-relaxed text-ink-4">
            {tr('UI preview — AI recommendations and live prices will be connected later.', 'Bản xem trước giao diện — gợi ý AI và giá trực tiếp sẽ được kết nối sau.')}
          </p>
        </Card>

        <section aria-label={tr('Itinerary preview', 'Xem trước lịch trình')}>
          {state === 'empty' && (
            <Card className="min-h-[560px] items-center justify-center gap-0 px-5 py-12 text-center sm:px-10">
              <span className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-accent text-accent-foreground">
                <Map className="h-9 w-9" />
                <Sparkles className="absolute -right-2 -top-2 h-6 w-6 fill-brand text-brand" />
              </span>
              <h2 className="mt-6 text-2xl font-bold text-foreground">{tr('Your route will unfold here', 'Lộ trình của bạn sẽ hiện ra tại đây')}</h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-body">
                {tr('Build a plan to see a realistic day-by-day preview, stay ideas, and a budget snapshot for your Vietnam trip.', 'Tạo kế hoạch để xem lịch trình từng ngày, gợi ý chỗ ở và tổng quan ngân sách cho chuyến đi Việt Nam.')}
              </p>
              <div className="mt-8 grid w-full max-w-lg gap-3 sm:grid-cols-3">
                {[
                  { Icon: Navigation, label: tr('Logical route', 'Lộ trình hợp lý') },
                  { Icon: Hotel, label: tr('Stay ideas', 'Gợi ý chỗ ở') },
                  { Icon: WalletCards, label: tr('Cost guide', 'Hướng dẫn chi phí') },
                ].map(({ Icon, label }) => (
                  <div key={label} className="flex items-center justify-center gap-2 rounded-xl bg-tint px-3 py-3 text-xs font-semibold text-body sm:flex-col sm:gap-2.5">
                    <Icon className="h-5 w-5 text-accent-foreground" />
                    {label}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {state === 'building' && (
            <div role="status" aria-live="polite">
              <span className="sr-only">{tr('Building your Vietnam itinerary.', 'Đang tạo lịch trình Việt Nam của bạn.')}</span>
              <PlannerLoading />
            </div>
          )}

          {state === 'ready' && (
            <div ref={resultRef} tabIndex={-1} className="space-y-5 outline-none duration-300 animate-in fade-in slide-in-from-bottom-2">
              <Card className="gap-0 overflow-hidden p-0">
                <div className="bg-primary px-5 py-5 text-white sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge variant="brand" size="sm" className="bg-white text-brand-deep">
                      <Sparkles className="h-3.5 w-3.5" />
                      {tr('Your AI itinerary preview', 'Bản xem trước lịch trình AI')}
                    </Badge>
                    <span className="text-xs font-semibold text-white">{days} {tr('days', 'ngày')}</span>
                  </div>
                  <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">{tr(destination.shortLabel, destination.shortLabelVi)}</h2>
                  <p className="mt-2 flex items-center gap-2 text-sm text-white"><Route className="h-4 w-4" />{tr(destination.route, destination.routeVi)}</p>
                </div>
                <div className="grid gap-px bg-border sm:grid-cols-3">
                  <div className="bg-card px-5 py-4">
                    <p className="text-2xs font-bold uppercase tracking-wider text-ink-4">{tr('Trip length', 'Thời lượng')}</p>
                    <p className="mt-1.5 text-sm font-bold text-foreground">{days} {tr('days', 'ngày')}</p>
                  </div>
                  <div className="bg-card px-5 py-4">
                    <p className="text-2xs font-bold uppercase tracking-wider text-ink-4">{tr('Budget guide', 'Ngân sách dự kiến')}</p>
                    <p className="mt-1.5 text-sm font-bold text-foreground">{formatVnd(estimatedBudget)}</p>
                  </div>
                  <div className="bg-card px-5 py-4">
                    <p className="text-2xs font-bold uppercase tracking-wider text-ink-4">{tr('Travel style', 'Phong cách')}</p>
                    <p className="mt-1.5 text-sm font-bold text-foreground">{tr(budget.label, budget.labelVi)}</p>
                  </div>
                </div>
              </Card>

              <section aria-labelledby="stay-suggestions-title">
                <div className="mb-3 flex items-end justify-between gap-3 px-1">
                  <div>
                    <p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Where to stay', 'Nơi lưu trú')}</p>
                    <h2 id="stay-suggestions-title" className="mt-1 text-xl font-bold text-foreground">{tr('Suggested stays', 'Chỗ ở gợi ý')}</h2>
                  </div>
                  <Badge variant="neutral" size="sm">{tr('Examples', 'Ví dụ')}</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {destination.stays.map((stay, index) => {
                    const priceFactor = index === 0 ? 0.55 : index === 1 ? 0.8 : 1
                    return (
                      <Card key={stay.name} className="gap-0 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint text-accent-foreground"><BedDouble className="h-4 w-4" /></span>
                          {index === 1 && <Badge variant="brand" size="sm">{tr('Best match', 'Phù hợp nhất')}</Badge>}
                        </div>
                        <h3 className="mt-4 text-sm font-bold leading-snug text-foreground">{tr(stay.name, stay.nameVi)}</h3>
                        <p className="mt-1 flex items-center gap-1 text-xs text-body"><MapPin className="h-3.5 w-3.5" />{tr(stay.area, stay.areaVi)}</p>
                        <p className="mt-3 text-xs leading-relaxed text-body">{tr(stay.note, stay.noteVi)}</p>
                        <p className="mt-3 text-xs font-bold text-accent-foreground">{tr('From', 'Từ')} {formatVnd(Math.round(budget.daily * priceFactor))}{tr('/night', '/đêm')}</p>
                      </Card>
                    )
                  })}
                </div>
                <p className="mt-2 px-1 text-2xs text-ink-4">{tr('Example stay types and estimated prices for the UI preview; not live availability.', 'Loại chỗ ở và giá ước tính trong bản xem trước giao diện; chưa phải tình trạng phòng trực tiếp.')}</p>
              </section>

              <section aria-labelledby="day-by-day-title">
                <div className="mb-3 px-1">
                  <p className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Your route', 'Lộ trình của bạn')}</p>
                  <h2 id="day-by-day-title" className="mt-1 text-xl font-bold text-foreground">{tr('Day by day', 'Từng ngày')}</h2>
                </div>
                <div className="space-y-3">
                  {tripDays.map((day, index) => (
                    <Card data-testid="itinerary-day" key={`${day.area}-${index}`} className="gap-0 p-0">
                      <div className="flex flex-col sm:flex-row">
                        <div className="flex shrink-0 items-center gap-3 bg-tint px-4 py-3 sm:w-28 sm:flex-col sm:justify-center sm:gap-1 sm:px-3 sm:text-center">
                          <span className="text-2xs font-bold uppercase tracking-wider text-accent-foreground">{tr('Day', 'Ngày')}</span>
                          <span className="text-2xl font-bold tabular-nums text-foreground">{index + 1}</span>
                        </div>
                        <div className="min-w-0 flex-1 px-4 py-4 sm:px-5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="flex items-center gap-1.5 text-xs font-semibold text-body"><MapPin className="h-3.5 w-3.5 text-accent-foreground" />{tr(day.area, day.areaVi)}</p>
                              <h3 className="mt-1 text-base font-bold text-foreground">{tr(day.title, day.titleVi)}</h3>
                            </div>
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-2xs font-semibold text-accent-foreground"><Clock3 className="h-3 w-3" />{tr('Balanced pace', 'Nhịp độ cân bằng')}</span>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <div className="flex gap-2.5"><Sun className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><div><p className="text-2xs font-bold uppercase tracking-wide text-ink-4">{tr('Morning', 'Buổi sáng')}</p><p className="mt-1 text-xs leading-relaxed text-body">{tr(day.morning, day.morningVi)}</p></div></div>
                            <div className="flex gap-2.5"><Compass className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" /><div><p className="text-2xs font-bold uppercase tracking-wide text-ink-4">{tr('Afternoon', 'Buổi chiều')}</p><p className="mt-1 text-xs leading-relaxed text-body">{tr(day.afternoon, day.afternoonVi)}</p></div></div>
                            <div className="flex gap-2.5"><MoonStar className="mt-0.5 h-4 w-4 shrink-0 text-brand-deep" /><div><p className="text-2xs font-bold uppercase tracking-wide text-ink-4">{tr('Evening', 'Buổi tối')}</p><p className="mt-1 text-xs leading-relaxed text-body">{tr(day.evening, day.eveningVi)}</p></div></div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>

              <Card className="flex-row items-start gap-3 bg-accent p-4 text-accent-foreground">
                <Coffee className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-bold">{tr('Built with breathing room', 'Lịch trình có khoảng nghỉ')}</p>
                  <p className="mt-1 text-xs leading-relaxed">{tr('This preview avoids packing every hour. The future AI version will adapt travel times, opening hours, weather, and live hotel availability.', 'Bản xem trước không xếp kín từng giờ. Phiên bản AI sau này sẽ điều chỉnh thời gian di chuyển, giờ mở cửa, thời tiết và tình trạng phòng trực tiếp.')}</p>
                </div>
              </Card>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
