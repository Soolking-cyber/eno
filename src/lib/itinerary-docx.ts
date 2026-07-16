import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import type { ActivityPlan, GeneratedItineraryResponse } from '@/components/itinerary/itinerary-data'

const BRAND = '0A66C2'
const BRAND_DEEP = '123F6D'
const INK = '172033'
const BODY = '4B5563'
const MUTED = '6B7280'
const PALE_BLUE = 'EAF4FF'
const PALE_GREY = 'F4F6F8'
const WHITE = 'FFFFFF'
const LINE = 'D8E0E8'

const noBorder = { style: BorderStyle.NONE, size: 0, color: WHITE }
const tableBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: LINE },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: LINE },
  left: { style: BorderStyle.SINGLE, size: 1, color: LINE },
  right: { style: BorderStyle.SINGLE, size: 1, color: LINE },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: LINE },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: LINE },
}

type Language = 'en' | 'vi'

function money(amount: number, lang: Language) {
  if (!amount) return '—'
  return new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    style: 'currency', currency: 'VND', maximumFractionDigits: 0,
  }).format(amount)
}

function dateLabel(value: string, lang: Language) {
  return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`))
}

function fileSlug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'vietnam-trip'
}

function textParagraph(text: string, options?: { bold?: boolean; color?: string; size?: number; before?: number; after?: number }) {
  return new Paragraph({
    spacing: { before: options?.before ?? 0, after: options?.after ?? 120, line: 290 },
    children: [new TextRun({ text, bold: options?.bold, color: options?.color ?? BODY, size: options?.size ?? 20 })],
  })
}

function sectionHeading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 140 },
    children: [new TextRun({ text, bold: true, color: BRAND_DEEP, size: 30 })],
  })
}

function subheading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 90 },
    children: [new TextRun({ text, bold: true, color: INK, size: 25 })],
  })
}

function bullet(text: string) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80, line: 280 },
    children: [new TextRun({ text, color: BODY, size: 20 })],
  })
}

function metricCell(label: string, value: string, fill = PALE_GREY) {
  return new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
    margins: { top: 180, bottom: 180, left: 180, right: 180 },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
    children: [
      new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: label.toUpperCase(), bold: true, color: MUTED, size: 15, characterSpacing: 20 })] }),
      new Paragraph({ children: [new TextRun({ text: value, bold: true, color: INK, size: 21 })] }),
    ],
  })
}

function labelCell(label: string, fill = PALE_BLUE) {
  return new TableCell({
    width: { size: 24, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
    margins: { top: 140, bottom: 140, left: 160, right: 160 },
    children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: BRAND_DEEP, size: 18 })] })],
  })
}

function valueCell(children: Paragraph[], width = 76) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 140, bottom: 140, left: 180, right: 180 },
    children,
  })
}

function activityRows(label: string, activity: ActivityPlan, lang: Language) {
  const meta = [
    activity.time,
    activity.travelMinutes > 0 ? `${activity.travelMinutes} ${lang === 'vi' ? 'phút di chuyển' : 'min travel'}` : '',
    activity.estimatedCostVnd > 0 ? money(activity.estimatedCostVnd, lang) : '',
  ].filter(Boolean).join('  •  ')
  return new TableRow({
    cantSplit: true,
    children: [
      labelCell(label),
      valueCell([
        new Paragraph({ spacing: { after: 55 }, children: [new TextRun({ text: activity.title, bold: true, color: INK, size: 20 }), new TextRun({ text: `  —  ${activity.place}`, color: BRAND, size: 19 })] }),
        new Paragraph({ spacing: { after: 55 }, children: [new TextRun({ text: activity.details, color: BODY, size: 18 })] }),
        new Paragraph({ spacing: { after: activity.bookingAdvice ? 55 : 0 }, children: [new TextRun({ text: meta, bold: true, color: MUTED, size: 16 })] }),
        ...(activity.bookingAdvice ? [new Paragraph({ children: [new TextRun({ text: activity.bookingAdvice, italics: true, color: BODY, size: 17 })] })] : []),
      ]),
    ],
  })
}

export async function downloadItineraryDocx(result: GeneratedItineraryResponse, travelers: number, lang: Language) {
  const plan = result.plan
  const tr = (en: string, vi: string) => lang === 'vi' ? vi : en
  const firstDay = plan.days[0]
  const lastDay = plan.days.at(-1)
  const children: Array<Paragraph | Table> = []

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
      rows: [new TableRow({ children: [new TableCell({
        shading: { fill: BRAND_DEEP, type: ShadingType.CLEAR, color: 'auto' },
        margins: { top: 420, bottom: 420, left: 420, right: 420 },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
        children: [
          new Paragraph({ spacing: { after: 150 }, children: [new TextRun({ text: 'eno', bold: true, color: WHITE, size: 24 }), new TextRun({ text: '.forum  /  VIETNAM ITINERARY', bold: true, color: 'B8D9F7', size: 17, characterSpacing: 30 })] }),
          new Paragraph({ spacing: { after: 150 }, children: [new TextRun({ text: plan.title, bold: true, color: WHITE, size: 42 })] }),
          new Paragraph({ spacing: { after: 130, line: 310 }, children: [new TextRun({ text: plan.summary, color: 'E7F1FA', size: 21 })] }),
          new Paragraph({ children: [new TextRun({ text: plan.routeSummary, bold: true, color: WHITE, size: 21 })] }),
        ],
      })] })],
    }),
    new Paragraph({ spacing: { after: 160 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
      rows: [new TableRow({ children: [
        metricCell(tr('Dates', 'Ngày'), firstDay && lastDay ? `${dateLabel(firstDay.date, lang)} – ${dateLabel(lastDay.date, lang)}` : '—'),
        metricCell(tr('Travelers', 'Số khách'), String(travelers), WHITE),
        metricCell(tr('Per traveler', 'Mỗi khách'), `${money(plan.budget.perTravelerLowVnd, lang)} – ${money(plan.budget.perTravelerHighVnd, lang)}`),
        metricCell(tr('Sources', 'Nguồn'), String(result.sources.length), WHITE),
      ] })],
    }),
    new Paragraph({ spacing: { after: 180 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
      rows: [new TableRow({ children: [new TableCell({
        shading: { fill: PALE_BLUE, type: ShadingType.CLEAR, color: 'auto' },
        margins: { top: 220, bottom: 220, left: 240, right: 240 },
        borders: { top: noBorder, bottom: noBorder, left: { style: BorderStyle.SINGLE, size: 14, color: BRAND }, right: noBorder },
        children: [
          new Paragraph({ spacing: { after: 70 }, children: [new TextRun({ text: tr('Want eno to handle the bookings?', 'Bạn muốn eno lo việc đặt chỗ?'), bold: true, color: BRAND_DEEP, size: 23 })] }),
          new Paragraph({ spacing: { after: 70 }, children: [new TextRun({ text: tr('eno Concierge can arrange stays and activities, call transport providers, and coordinate the details. The service fee is 10% of the bookings we arrange; you approve every cost first.', 'eno Concierge có thể đặt chỗ ở và hoạt động, gọi đơn vị vận chuyển và điều phối chi tiết. Phí dịch vụ là 10% giá trị đặt chỗ do eno sắp xếp; bạn duyệt mọi chi phí trước.'), color: BODY, size: 19 })] }),
          new Paragraph({ children: [new ExternalHyperlink({ link: `mailto:support@eno.vn?subject=${encodeURIComponent(`eno Concierge — ${plan.title}`)}`, children: [new TextRun({ text: 'support@eno.vn', bold: true, color: BRAND, underline: {} })] })] }),
        ],
      })] })],
    }),
  )

  children.push(sectionHeading(tr('Budget and route', 'Ngân sách và lộ trình')))
  children.push(textParagraph(`${tr('Group estimate', 'Ước tính cả nhóm')}: ${money(plan.budget.groupLowVnd, lang)} – ${money(plan.budget.groupHighVnd, lang)}. ${plan.budget.note}`))
  children.push(textParagraph(plan.routeRationale, { after: 150 }))
  if (plan.routeLegs.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, borders: tableBorders,
      rows: plan.routeLegs.map((leg) => new TableRow({ cantSplit: true, children: [
        labelCell(`${leg.from} → ${leg.to}`),
        valueCell([new Paragraph({ spacing: { after: 45 }, children: [new TextRun({ text: `${leg.mode}  •  ${leg.duration}`, bold: true, color: INK, size: 19 })] }), textParagraph(leg.advice, { after: 0, size: 18 })]),
      ] })),
    }))
  }

  if (plan.flights.length) {
    children.push(sectionHeading(tr('Flight leads', 'Gợi ý chuyến bay')))
    for (const flight of plan.flights) {
      children.push(subheading(flight.label))
      children.push(textParagraph(`${flight.route}  •  ${flight.date}  •  ${flight.departureWindow}  •  ${flight.duration}  •  ${flight.stops === 0 ? tr('Direct', 'Bay thẳng') : `${flight.stops} ${tr('stop(s)', 'điểm dừng')}`}`, { bold: true, color: INK, after: 70 }))
      children.push(textParagraph(`${flight.airlines.join(', ') || '—'}  •  ${flight.priceLowVnd ? `${money(flight.priceLowVnd, lang)} – ${money(flight.priceHighVnd, lang)}` : tr('Fare unavailable', 'Chưa có giá')}`, { after: 60 }))
      children.push(textParagraph(flight.fareNote, { after: 90, size: 18 }))
      if (flight.url) children.push(new Paragraph({ spacing: { after: 100 }, children: [new ExternalHyperlink({ link: flight.url, children: [new TextRun({ text: tr('Check this flight option', 'Kiểm tra chuyến bay này'), bold: true, color: BRAND, underline: {} })] })] }))
    }
  }

  children.push(sectionHeading(tr('Stay shortlist', 'Danh sách chỗ ở')))
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, borders: tableBorders,
    rows: plan.stays.map((stay) => new TableRow({ cantSplit: true, children: [
      labelCell(stay.city),
      valueCell([
        new Paragraph({ spacing: { after: 45 }, children: [new TextRun({ text: stay.name, bold: true, color: INK, size: 20 }), new TextRun({ text: `  •  ${stay.category}`, color: MUTED, size: 17 })] }),
        new Paragraph({ spacing: { after: 45 }, children: [new TextRun({ text: `${stay.area}  •  ${money(stay.nightlyLowVnd, lang)} – ${money(stay.nightlyHighVnd, lang)}${tr('/night', '/đêm')}`, bold: true, color: BRAND_DEEP, size: 18 })] }),
        textParagraph(stay.why, { after: 0, size: 18 }),
        ...(stay.url ? [new Paragraph({ spacing: { before: 70 }, children: [new ExternalHyperlink({ link: stay.url, children: [new TextRun({ text: tr('View property', 'Xem chỗ ở'), bold: true, color: BRAND, underline: {} })] })] })] : []),
      ]),
    ] })),
  }))

  children.push(sectionHeading(tr('Day-by-day plan', 'Kế hoạch từng ngày')))
  for (const day of plan.days) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, keepNext: true,
      spacing: { before: 280, after: 70 },
      children: [new TextRun({ text: `${tr('Day', 'Ngày')} ${day.dayNumber}`, bold: true, color: BRAND, size: 18 }), new TextRun({ text: `  ${day.title}`, bold: true, color: INK, size: 27 })],
    }))
    children.push(textParagraph(`${dateLabel(day.date, lang)}  •  ${day.city}  •  ${day.paceNote}`, { bold: true, color: MUTED, after: 60, size: 17 }))
    children.push(textParagraph(day.focus, { after: 110, size: 18 }))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, borders: tableBorders,
      rows: [
        activityRows(tr('Morning', 'Buổi sáng'), day.morning, lang),
        activityRows(tr('Afternoon', 'Buổi chiều'), day.afternoon, lang),
        activityRows(tr('Evening', 'Buổi tối'), day.evening, lang),
      ],
    }))
    children.push(textParagraph(`${tr('Food', 'Ẩm thực')}: ${day.foodNote}`, { before: 90, after: 50, size: 18 }))
    children.push(textParagraph(`${tr('Estimated day cost', 'Ước tính chi phí ngày')}: ${money(day.estimatedDailyCostVnd, lang)}`, { bold: true, color: BRAND_DEEP, after: 100, size: 18 }))
  }

  children.push(sectionHeading(tr('Practical trip brief', 'Thông tin thực tế')))
  const practical = [
    [tr('Arrival', 'Đến nơi'), plan.practical.arrival],
    [tr('Getting around', 'Di chuyển'), plan.practical.localTransport],
    [tr('Connectivity', 'Kết nối'), plan.practical.connectivity],
    [tr('Money', 'Tiền tệ'), plan.practical.money],
    [tr('Weather', 'Thời tiết'), plan.practical.weather],
    [tr('Safety', 'An toàn'), plan.practical.safety],
  ]
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, borders: tableBorders,
    rows: practical.map(([label, value]) => new TableRow({ cantSplit: true, children: [labelCell(label), valueCell([textParagraph(value, { after: 0, size: 18 })])] })),
  }))

  children.push(sectionHeading(tr('What to book, and when', 'Nên đặt gì và khi nào')))
  for (const item of plan.bookingChecklist) {
    children.push(new Paragraph({ spacing: { after: 45 }, children: [new TextRun({ text: `${item.when}  •  `, bold: true, color: BRAND, size: 19 }), new TextRun({ text: item.item, bold: true, color: INK, size: 19 })] }))
    children.push(textParagraph(item.reason, { after: 100, size: 18 }))
  }

  if (plan.assumptions.length) {
    children.push(sectionHeading(tr('Planning assumptions', 'Giả định khi lập kế hoạch')))
    children.push(...plan.assumptions.map(bullet))
  }

  children.push(sectionHeading(tr('Research sources', 'Nguồn nghiên cứu')))
  if (result.sources.length) {
    children.push(...result.sources.map((source) => new Paragraph({
      bullet: { level: 0 }, spacing: { after: 70 },
      children: [new ExternalHyperlink({ link: source.url, children: [new TextRun({ text: source.title || source.domain, color: BRAND, underline: {}, size: 18 })] }), new TextRun({ text: `  (${source.domain})`, color: MUTED, size: 16 })],
    })))
  } else {
    children.push(textParagraph(tr('No source links were returned for this plan.', 'Không có liên kết nguồn cho kế hoạch này.')))
  }

  children.push(textParagraph(tr(
    'This plan is a travel aid, not confirmed inventory. Seats, fares, rooms, opening hours, visa rules, and weather can change. Confirm important details before paying.',
    'Kế hoạch này hỗ trợ chuyến đi, không phải tình trạng chỗ đã xác nhận. Chỗ ngồi, giá vé, phòng, giờ mở cửa, quy định thị thực và thời tiết có thể thay đổi. Hãy xác nhận trước khi thanh toán.',
  ), { before: 260, after: 0, color: MUTED, size: 16 }))

  const document = new Document({
    creator: 'eno',
    title: plan.title,
    subject: 'Vietnam itinerary',
    description: 'A researched Vietnam itinerary prepared by eno.',
    styles: {
      default: {
        document: { run: { font: 'Aptos', color: BODY, size: 20 }, paragraph: { spacing: { line: 290 } } },
        heading1: { run: { font: 'Aptos Display', bold: true, color: BRAND_DEEP, size: 30 }, paragraph: { spacing: { before: 300, after: 140 } } },
        heading2: { run: { font: 'Aptos Display', bold: true, color: INK, size: 25 }, paragraph: { spacing: { before: 220, after: 90 } } },
        hyperlink: { run: { color: BRAND, underline: {} } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 920, right: 900, bottom: 900, left: 900, header: 420, footer: 420 } } },
      headers: { default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE } }, spacing: { after: 100 },
        children: [new TextRun({ text: 'eno', bold: true, color: BRAND, size: 19 }), new TextRun({ text: '.forum  •  ', bold: true, color: INK, size: 17 }), new TextRun({ text: plan.routeSummary, color: MUTED, size: 16 })],
      })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: ['www.eno.forum  •  ', PageNumber.CURRENT], color: MUTED, size: 15 })],
      })] }) },
      children,
    }],
  })

  const blob = await Packer.toBlob(document)
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = `eno-itinerary-${fileSlug(plan.title)}.docx`
  window.document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
