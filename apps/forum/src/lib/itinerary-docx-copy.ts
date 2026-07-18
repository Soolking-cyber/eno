import type { GeneratedItineraryResponse } from '@/components/itinerary/itinerary-data'
import { buildItineraryResourceGroups } from '@/components/itinerary/itinerary-resources'

export const ITINERARY_DOCX_COPY: Array<[string, string]> = [
  ['Vietnam itinerary', 'Lịch trình Việt Nam'],
  ['Dates', 'Ngày'], ['Travelers', 'Số khách'], ['Per traveler', 'Mỗi khách'], ['Useful links', 'Liên kết'],
  ['Want eno to handle the bookings?', 'Bạn muốn eno lo việc đặt chỗ?'],
  ['eno Concierge can arrange stays and activities, call transport providers, and coordinate the details. The service fee is 10% of the bookings we arrange; you approve every cost first.', 'eno Concierge có thể đặt chỗ ở và hoạt động, gọi đơn vị vận chuyển và điều phối chi tiết. Phí dịch vụ là 10% giá trị đặt chỗ do eno sắp xếp; bạn duyệt mọi chi phí trước.'],
  ['Budget and route', 'Ngân sách và lộ trình'], ['Group estimate', 'Ước tính cả nhóm'], ['Flight leads', 'Gợi ý chuyến bay'],
  ['Direct', 'Bay thẳng'], ['stop(s)', 'điểm dừng'], ['Fare unavailable', 'Chưa có giá'], ['Check this flight option', 'Kiểm tra chuyến bay này'],
  ['Stay shortlist', 'Danh sách chỗ ở'], ['/night', '/đêm'], ['View property', 'Xem chỗ ở'], ['Day-by-day plan', 'Kế hoạch từng ngày'],
  ['Day', 'Ngày'], ['Morning', 'Buổi sáng'], ['Afternoon', 'Buổi chiều'], ['Evening', 'Buổi tối'], ['Food', 'Ẩm thực'],
  ['Estimated day cost', 'Ước tính chi phí ngày'], ['Practical trip brief', 'Thông tin thực tế'], ['Arrival', 'Đến nơi'],
  ['Getting around', 'Di chuyển'], ['Connectivity', 'Kết nối'], ['Money', 'Tiền tệ'], ['Weather', 'Thời tiết'], ['Safety', 'An toàn'],
  ['What to book, and when', 'Nên đặt gì và khi nào'], ['Planning assumptions', 'Giả định khi lập kế hoạch'],
  ['Travel services and plan links', 'Dịch vụ du lịch và liên kết lịch trình'], ['min travel', 'phút di chuyển'],
  ['Booking, transport, visa, community, maps, and every link from this itinerary are collected here for quick access.', 'Đặt chỗ, di chuyển, visa, cộng đồng, bản đồ và mọi liên kết trong lịch trình được tập hợp tại đây để truy cập nhanh.'],
  ['This plan is a travel aid, not confirmed inventory. Seats, fares, rooms, opening hours, visa rules, and weather can change. Confirm important details before paying.', 'Kế hoạch này hỗ trợ chuyến đi, không phải tình trạng chỗ đã xác nhận. Chỗ ngồi, giá vé, phòng, giờ mở cửa, quy định thị thực và thời tiết có thể thay đổi. Hãy xác nhận trước khi thanh toán.'],
  ['A researched Vietnam itinerary prepared by eno.', 'Lịch trình Việt Nam do eno nghiên cứu và chuẩn bị.'],
]

export function itineraryDocxTranslationSources(result: GeneratedItineraryResponse): string[] {
  const resourceCopy = buildItineraryResourceGroups(result).flatMap((group) => [
    [group.title, group.titleVi] as [string, string],
    [group.description, group.descriptionVi] as [string, string],
    ...group.resources.flatMap((resource) => [
      [resource.title, resource.titleVi] as [string, string],
      [resource.description, resource.descriptionVi] as [string, string],
    ]),
  ])
  return Array.from(new Set([...ITINERARY_DOCX_COPY, ...resourceCopy].map(([english]) => english).filter(Boolean)))
}
