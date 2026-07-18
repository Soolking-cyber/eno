import type { GeneratedItineraryResponse } from './itinerary-data'

export type ItineraryResourceKind =
  | 'concierge'
  | 'marketplace'
  | 'community'
  | 'visa'
  | 'ride'
  | 'bus'
  | 'rail'
  | 'flight'
  | 'stay'
  | 'map'
  | 'tourism'
  | 'source'

export type ItineraryResource = {
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  url: string
  kind: ItineraryResourceKind
}

export type ItineraryResourceGroup = {
  id: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  resources: ItineraryResource[]
}

// Render-layer scheme allowlist (audit Phase 1 defense-in-depth): every AI-origin
// url (flights/stays/sources) is safeUrl'd at generation time, but THIS builder is
// the last gate before <a href> — a javascript:/data: url must never survive it,
// whatever upstream produced.
const SAFE_SCHEMES = /^(https?:|mailto:)/i
function safeHrefOnly(resources: ItineraryResource[]) {
  return resources.filter((resource) => SAFE_SCHEMES.test(resource.url.trim()))
}

function uniqueResources(resources: ItineraryResource[]) {
  const seen = new Set<string>()
  return resources.filter((resource) => {
    const key = resource.url.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mapSearch(place: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place}, Vietnam`)}`
}

export function buildItineraryResourceGroups(result: GeneratedItineraryResponse): ItineraryResourceGroup[] {
  const { plan } = result
  const conciergeSubject = encodeURIComponent(`eno Concierge — ${plan.title}`)
  const conciergeBody = encodeURIComponent(`I would like eno Concierge to help arrange this itinerary: ${plan.title}. Please contact me about bookings, transport calls, or visa support.`)
  const visaSubject = encodeURIComponent(`eno Visa support — ${plan.title}`)
  const visaBody = encodeURIComponent(`I would like help understanding or arranging visa services for this Vietnam trip: ${plan.title}.`)

  const enoResources: ItineraryResource[] = [
    {
      title: 'eno Concierge', titleVi: 'eno Concierge', kind: 'concierge',
      description: 'Ask eno to coordinate bookings and call transport providers; the fee is 10% of bookings arranged, with your approval first.',
      descriptionVi: 'Nhờ eno điều phối đặt chỗ và gọi đơn vị vận chuyển; phí là 10% giá trị đặt chỗ được sắp xếp và bạn duyệt trước.',
      url: `mailto:support@eno.vn?subject=${conciergeSubject}&body=${conciergeBody}`,
    },
    {
      title: 'eno Travel Marketplace', titleVi: 'Chợ du lịch eno', kind: 'marketplace',
      description: 'Find local tours, transport, tickets, and travel services from Vietnam-based providers.',
      descriptionVi: 'Tìm tour, phương tiện, vé và dịch vụ du lịch từ các nhà cung cấp tại Việt Nam.',
      url: 'https://eno.vn/?category=tickets-travel',
    },
    {
      title: 'eno Visa Services', titleVi: 'Dịch vụ visa eno', kind: 'visa',
      description: 'Browse visa and legal-service listings, or contact eno if you need help choosing the right next step.',
      descriptionVi: 'Xem dịch vụ visa và pháp lý, hoặc liên hệ eno nếu bạn cần hỗ trợ chọn bước tiếp theo.',
      url: 'https://eno.vn/?category=services&subcategory=visa-legal',
    },
    {
      title: 'Ask eno about visa support', titleVi: 'Hỏi eno về hỗ trợ visa', kind: 'visa',
      description: 'Send your trip details to eno for practical visa-service assistance.',
      descriptionVi: 'Gửi thông tin chuyến đi cho eno để được hỗ trợ dịch vụ visa thực tế.',
      url: `mailto:support@eno.vn?subject=${visaSubject}&body=${visaBody}`,
    },
    {
      title: 'eno Community Forum', titleVi: 'Diễn đàn cộng đồng eno', kind: 'community',
      description: 'Ask travelers, expats, and locals about places, transport, visas, and day-to-day travel questions.',
      descriptionVi: 'Hỏi du khách, người nước ngoài và người địa phương về điểm đến, di chuyển, visa và các vấn đề thực tế.',
      url: 'https://www.eno.forum/',
    },
  ]

  const bookingResources: ItineraryResource[] = [
    {
      title: 'Official Vietnam e-Visa', titleVi: 'E-Visa Việt Nam chính thức', kind: 'visa',
      description: 'Check eligibility and apply through the Immigration Department website; verify requirements before paying.',
      descriptionVi: 'Kiểm tra điều kiện và nộp hồ sơ trên trang của Cục Quản lý xuất nhập cảnh; xác minh yêu cầu trước khi thanh toán.',
      url: 'https://evisa.gov.vn/',
    },
    {
      title: 'Grab Vietnam', titleVi: 'Grab Việt Nam', kind: 'ride',
      description: 'Download the app for local rides and airport or station transfers where service is available.',
      descriptionVi: 'Tải ứng dụng để đặt xe nội thành và đưa đón sân bay hoặc nhà ga tại nơi có dịch vụ.',
      url: 'https://www.grab.com/vn/en/download/',
    },
    {
      title: 'VeXeRe', titleVi: 'VeXeRe', kind: 'bus',
      description: 'Compare and book intercity buses, trains, flights, and vehicle rentals across Vietnam.',
      descriptionVi: 'So sánh và đặt xe khách, tàu, chuyến bay và thuê xe trên khắp Việt Nam.',
      url: 'https://vexere.com/en-US',
    },
    {
      title: 'Vietnam Railways', titleVi: 'Đường sắt Việt Nam', kind: 'rail',
      description: 'Check official train schedules and tickets directly with Vietnam Railways.',
      descriptionVi: 'Kiểm tra lịch tàu và vé chính thức trực tiếp với Đường sắt Việt Nam.',
      url: 'https://dsvn.vn/',
    },
    {
      title: 'Vietnam Airlines', titleVi: 'Vietnam Airlines', kind: 'flight',
      description: 'Check and manage flights through the airline’s official website.',
      descriptionVi: 'Kiểm tra và quản lý chuyến bay trên trang chính thức của hãng.',
      url: 'https://www.vietnamairlines.com/vn/en/home',
    },
    {
      title: 'Vietjet Air', titleVi: 'Vietjet Air', kind: 'flight',
      description: 'Search domestic and international fares on Vietjet’s official booking channel.',
      descriptionVi: 'Tìm giá vé nội địa và quốc tế trên kênh đặt vé chính thức của Vietjet.',
      url: 'https://www.vietjetair.com/en/flight-tickets',
    },
    {
      title: 'Agoda Vietnam stays', titleVi: 'Chỗ ở Việt Nam trên Agoda', kind: 'stay',
      description: 'Compare accommodation options, then recheck the property, room terms, and final price before payment.',
      descriptionVi: 'So sánh chỗ ở, sau đó kiểm tra lại nơi lưu trú, điều kiện phòng và giá cuối trước khi thanh toán.',
      url: 'https://www.agoda.com/country/vietnam.html',
    },
    {
      title: 'Official Vietnam Tourism', titleVi: 'Du lịch Việt Nam chính thức', kind: 'tourism',
      description: 'Use Vietnam’s official tourism website for destination and travel information.',
      descriptionVi: 'Tham khảo trang du lịch chính thức của Việt Nam về điểm đến và thông tin chuyến đi.',
      url: 'https://vietnam.travel/',
    },
  ]

  const planResources = uniqueResources(safeHrefOnly([
    ...plan.flights.filter((flight) => flight.url).map((flight): ItineraryResource => ({
      title: flight.label,
      titleVi: flight.label,
      description: `${flight.route} · ${flight.date} · ${flight.airlines.join(', ') || 'Flight option'}`,
      descriptionVi: `${flight.route} · ${flight.date} · ${flight.airlines.join(', ') || 'Lựa chọn chuyến bay'}`,
      url: flight.url,
      kind: 'flight',
    })),
    ...plan.stays.filter((stay) => stay.url).map((stay): ItineraryResource => ({
      title: stay.name,
      titleVi: stay.name,
      description: `${stay.city} · ${stay.area} · ${stay.category}`,
      descriptionVi: `${stay.city} · ${stay.area} · ${stay.category}`,
      url: stay.url,
      kind: 'stay',
    })),
  ]))

  const places = uniqueResources(plan.days.flatMap((day) => [day.morning, day.afternoon, day.evening]).flatMap((activity) => {
    const place = activity.place.trim()
    if (!place) return []
    return [{
      title: place,
      titleVi: place,
      description: 'Open this itinerary stop in Google Maps to review the location, route, hours, and recent traveler information.',
      descriptionVi: 'Mở điểm dừng này trong Google Maps để xem vị trí, đường đi, giờ hoạt động và thông tin du khách gần đây.',
      url: mapSearch(place),
      kind: 'map' as const,
    }]
  }))

  const sources = uniqueResources(safeHrefOnly(result.sources.map((source): ItineraryResource => ({
    title: source.title || source.domain,
    titleVi: source.title || source.domain,
    description: source.domain,
    descriptionVi: source.domain,
    url: source.url,
    kind: 'source',
  }))))

  return [
    {
      id: 'eno-help', title: 'eno travel help', titleVi: 'Hỗ trợ du lịch eno',
      description: 'Local services, community knowledge, and hands-on booking or visa assistance.',
      descriptionVi: 'Dịch vụ địa phương, kiến thức cộng đồng và hỗ trợ đặt chỗ hoặc visa.',
      resources: enoResources,
    },
    {
      id: 'booking-transport', title: 'Booking and transport', titleVi: 'Đặt chỗ và di chuyển',
      description: 'Useful official and established services to prepare before departure.',
      descriptionVi: 'Các dịch vụ chính thức và phổ biến hữu ích để chuẩn bị trước khi khởi hành.',
      resources: bookingResources,
    },
    {
      id: 'plan-links', title: 'Links from your itinerary', titleVi: 'Liên kết trong lịch trình',
      description: 'Flight and accommodation pages returned specifically for this plan.',
      descriptionVi: 'Trang chuyến bay và chỗ ở được trả về riêng cho lịch trình này.',
      resources: planResources,
    },
    {
      id: 'places', title: 'Places in your itinerary', titleVi: 'Địa điểm trong lịch trình',
      description: 'Every named itinerary stop collected as a map search for quick access.',
      descriptionVi: 'Mọi điểm dừng được nêu trong lịch trình, tập hợp thành liên kết bản đồ để truy cập nhanh.',
      resources: places,
    },
    {
      id: 'research', title: 'Research sources', titleVi: 'Nguồn nghiên cứu',
      description: 'Pages used while preparing this itinerary; details can still change.',
      descriptionVi: 'Các trang được dùng khi chuẩn bị lịch trình; thông tin vẫn có thể thay đổi.',
      resources: sources,
    },
  ].filter((group) => group.resources.length > 0)
}
