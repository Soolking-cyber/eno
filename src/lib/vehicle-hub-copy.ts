import type { LinkState } from './vehicle-hub-stats'

/**
 * THE HUB'S TRUST COPY — intro and disclosure — as a pure function of what is actually live, so the
 * three link states are unit-tested rather than reasoned about (codex/opus review, 2026-09-29).
 *
 *   · all  — every row books on its source: "reference listings", "every car links to …".
 *   · some — a person posted directly on eno.vn beside the imports: name only the linked sources,
 *            say the rest are answered in chat, and never say "every" or "each one".
 *   · none — nothing books elsewhere: no reference-listing disclosure at all.
 *
 * `from` is the LINKED sources' names already joined ("Mioto and BonbonCar"), never a private seller.
 */
export type HubCopyInput = {
  kind: 'car' | 'motorbike'; lang: 'en' | 'vi'; state: LinkState; n: string; from: string
  /** SITE_NAME — the page builds on eno.forum too, and there "not with eno.vn" would misname the site (codex). */
  site: string
}

export function hubIntro({ kind, lang, state, n, from, site }: HubCopyInput): string {
  const vi = lang === 'vi'
  if (kind === 'car') {
    const where = !from ? '' : state === 'all' ? (vi ? `, đăng trên ${from}` : `, listed on ${from}`) : (vi ? `, trong đó có xe đăng trên ${from}` : `, including cars listed on ${from}`)
    const tail = state === 'all'
      ? (vi ? ' Mỗi xe đều dẫn tới trang nơi bạn đặt xe.' : ' Every car links to the page where you book it.')
      : state === 'some'
        ? (vi ? ` Xe từ nguồn khác dẫn tới trang đặt xe của nguồn đó; xe đăng trực tiếp trên ${site} thì nhắn tin với chủ xe.` : ` A car from another site links to the page where you book it; one posted on ${site} is answered in chat.`)
        : ''
    return vi
      ? `${n} xe ô tô tự lái cho thuê tại TP.HCM (Sài Gòn)${where}, gom về một trang: giá thuê một ngày theo loại xe, xe ở quận nào và cách đặt xe.${tail}`
      : `${n} self-drive cars for hire in Ho Chi Minh City (Saigon)${where}, on one page: what a day costs by car size, where the cars are, and how booking works.${tail}`
  }
  const where = !from ? '' : state === 'all' ? (vi ? ` từ các cửa hàng ${from}` : ` from ${from}`) : (vi ? `, trong đó có xe của ${from}` : `, including bikes from ${from}`)
  return vi
    ? `${n} xe máy cho thuê tại TP.HCM (Sài Gòn)${where}: xe ga và xe số, thuê theo ngày hoặc theo tháng, kèm giá thuê thực tế của từng loại và cách đặt xe.`
    : `${n} motorbikes and scooters for rent in Ho Chi Minh City (Saigon)${where}: automatic and manual, by the day or by the month, with what each actually costs and how booking works.`
}

export function hubDisclosure({ kind, lang, state, from, site }: HubCopyInput): string | undefined {
  if (state === 'none' || !from) return undefined
  const vi = lang === 'vi'
  if (state === 'some') {
    return vi
      ? `Xe từ ${from} là tin tham khảo: ${site} dẫn tới tin gốc, và việc đặt xe, thanh toán, tiền cọc làm với nguồn đó, không qua ${site}. Các xe còn lại do chủ xe đăng trực tiếp trên ${site} và bạn nhắn tin với họ trong ứng dụng.`
      : `Listings from ${from} are reference listings: ${site} links to each original, and you book, pay and leave the deposit with that source, not with ${site}. The rest are posted directly on ${site} by their owners, and you message them in the app.`
  }
  if (kind === 'car') {
    return vi
      ? `Đây là các tin tham khảo: ${site} hiển thị xe do ${from} đăng và dẫn tới từng tin gốc. Bạn đặt xe, thanh toán và ký hợp đồng thuê với họ, không phải với ${site}. Hãy xác nhận giá cuối cùng, tiền cọc và lịch xe trống trên trang đặt xe.`
      : `These are reference listings: ${site} shows cars published by ${from} and links to each original. You book, pay and sign the rental with them, not with ${site}. Confirm the final price, deposit and availability on the booking page.`
  }
  return vi
    ? `Đây là các tin tham khảo từ ${from}: ${site} hiển thị xe của cửa hàng và dẫn tới trang của họ. Bạn đặt xe, thanh toán và để lại tiền cọc với cửa hàng, không phải với ${site}. Hãy xác nhận giá và xe trống với cửa hàng.`
    : `These are reference listings from ${from}: ${site} shows the shops’ bikes and links to their pages. You book, pay and leave the deposit with the shop, not with ${site}. Confirm the price and availability with the shop.`
}

/** The "How booking works" first paragraph, per state. */
export function hubBooking({ kind, lang, state, from, site }: HubCopyInput): string {
  const vi = lang === 'vi'
  const car = kind === 'car'
  if (state === 'all') {
    return car
      ? (vi ? `Bấm vào một xe để xem chi tiết, rồi bấm nút đặt xe để sang trang của nguồn. Việc đặt xe, thanh toán, hợp đồng thuê và tiền cọc đều làm với nguồn đó, không qua ${site}.`
            : `Open a car to see its details, then use its booking button to go to the source. You book, pay, sign the rental and hand over the deposit with that source — not with ${site}.`)
      : (vi ? `Mỗi xe là tin của một cửa hàng cho thuê tại TP.HCM. Bấm vào xe để xem chi tiết, rồi dùng nút trên trang để sang trang của cửa hàng; việc đặt xe, thanh toán và tiền cọc làm trực tiếp với cửa hàng, không qua ${site}.`
            : `Every bike here is a Ho Chi Minh City rental shop’s listing. Open one for its details, then use its button to go to the shop; you book, pay and leave the deposit with the shop, not with ${site}.`)
  }
  if (state === 'some') {
    return vi
      ? `Xe từ ${from} có nút dẫn sang trang của nguồn, và việc đặt xe, thanh toán, tiền cọc làm với nguồn đó, không qua ${site}. Xe do chủ đăng trực tiếp trên ${site} thì bạn nhắn tin với chủ xe trong ứng dụng để thỏa thuận.`
      : `A ${car ? 'car' : 'bike'} from ${from} has a button to the source’s page, and you book, pay and leave the deposit there, not with ${site}. One posted directly on ${site} is arranged with its owner in the app’s chat.`
  }
  return vi
    ? 'Bấm vào một xe để xem chi tiết và nhắn tin với chủ xe trong ứng dụng để thỏa thuận giá, tiền cọc và giấy tờ.'
    : `Open a ${car ? 'car' : 'bike'} to see its details and message its owner in the app to agree the price, deposit and paperwork.`
}
