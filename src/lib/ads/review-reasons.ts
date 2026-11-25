/**
 * ── WHY AN AD WAS REFUSED, IN WORDS (owner 2026-11-25: "jev should check before they pay whether ad is appropriate").
 * Pure: the review (creative-review.ts) answers each refusal as one stable `code` plus one English and one Vietnamese
 * sentence, the same in the HTTP 422, the MCP result, the shop's dashboard and the admin's Ads list. A code is a contract
 * (clients branch on it): add codes, never rename one.
 *
 * ⛔ Banned classes and Art. 8 claims REFUSE. Permit classes (medicines, cosmetics, finance …) are ALLOWED since the
 * owner's 2026-11-25 change: they are recorded on the creative (`scores.permitClasses`), shown to admins, never a reason.
 */
export type ReviewReason = { code: string; en: string; vi: string }

const R = (en: string, vi: string) => ({ en, vi })

export const REVIEW_REASONS = {
  // ── The fields (checked before anything is fetched or paid for) ───────────────────────────────────────────────────
  creative_invalid: R('The ad is missing or not an object of fields.', 'Thiếu nội dung quảng cáo hoặc sai định dạng.'),
  legal_name_invalid: R('Give the advertiser\'s registered legal name (2 to 120 characters).', 'Hãy ghi tên pháp lý đã đăng ký của bên quảng cáo (2 đến 120 ký tự).'),
  tax_code_invalid: R('Give the advertiser\'s tax code (MST): 10 digits, or 13 digits written 10-3.', 'Hãy ghi mã số thuế (MST) của bên quảng cáo: 10 chữ số, hoặc 13 chữ số dạng 10-3.'),
  advertiser_name_invalid: R('Give the name shown on the ad (2 to 40 characters).', 'Hãy ghi tên hiển thị trên quảng cáo (2 đến 40 ký tự).'),
  headline_invalid: R('Write a headline of 2 to 60 characters.', 'Hãy viết tiêu đề từ 2 đến 60 ký tự.'),
  body_invalid: R('The text under the headline can be at most 120 characters.', 'Phần mô tả dưới tiêu đề tối đa 120 ký tự.'),
  permit_ref_invalid: R('The permit or confirmation number can be at most 80 characters.', 'Số giấy phép hoặc số xác nhận tối đa 80 ký tự.'),
  image_url_invalid: R('The picture must be an https:// address.', 'Ảnh phải là một địa chỉ https://.'),
  click_url_invalid: R('The landing page must be an https:// address on a public website.', 'Trang đích phải là một địa chỉ https:// trên một website công khai.'),
  // ── The picture ────────────────────────────────────────────────────────────────────────────────────────────────────
  image_unreachable: R('We could not download the picture. Check that its address opens publicly.', 'Chúng tôi không tải được ảnh. Hãy kiểm tra địa chỉ ảnh mở được công khai.'),
  image_too_large: R('The picture is over 5 MB.', 'Ảnh lớn hơn 5 MB.'),
  image_type: R('The picture must be a JPEG, PNG or WebP file.', 'Ảnh phải là tệp JPEG, PNG hoặc WebP.'),
  image_too_small: R('The picture must be at least 600 × 600 pixels.', 'Ảnh phải có kích thước tối thiểu 600 × 600 điểm ảnh.'),
  image_aspect: R('The picture must be about square (width to height between 0.8 and 1.25).', 'Ảnh phải gần vuông (tỉ lệ rộng trên cao từ 0,8 đến 1,25).'),
  // ── The landing page ───────────────────────────────────────────────────────────────────────────────────────────────
  landing_unreachable: R('We could not open the landing page. It must answer publicly over https.', 'Chúng tôi không mở được trang đích. Trang phải truy cập công khai qua https.'),
  landing_not_page: R('The landing page must be a web page, not a file to download.', 'Trang đích phải là một trang web, không phải tệp để tải về.'),
  // ── The words ──────────────────────────────────────────────────────────────────────────────────────────────────────
  banned_word: R('The ad names something that cannot be advertised or sold on eno.', 'Quảng cáo nhắc đến hàng hóa hoặc dịch vụ không được quảng cáo hay mua bán trên eno.'),
  banned_tobacco: R('Tobacco, cigarettes, e-cigarettes and vapes cannot be advertised.', 'Không được quảng cáo thuốc lá, thuốc lá điện tử và vape.'),
  banned_alcohol: R('Drinks of 15% alcohol or more cannot be advertised.', 'Không được quảng cáo đồ uống có độ cồn từ 15% trở lên.'),
  banned_infant_formula: R('Breast-milk substitutes and feeding products for children under 24 months cannot be advertised.', 'Không được quảng cáo sản phẩm thay thế sữa mẹ và sản phẩm dinh dưỡng cho trẻ dưới 24 tháng tuổi.'),
  banned_prescription_drugs: R('Prescription medicines cannot be advertised.', 'Không được quảng cáo thuốc kê đơn.'),
  banned_weapons: R('Weapons, explosives and military or police equipment cannot be advertised.', 'Không được quảng cáo vũ khí, vật liệu nổ và trang thiết bị quân sự, công an.'),
  banned_fireworks: R('Fireworks cannot be advertised.', 'Không được quảng cáo pháo.'),
  banned_gambling: R('Gambling, betting and lotteries cannot be advertised.', 'Không được quảng cáo cờ bạc, cá cược và xổ số.'),
  banned_sexual: R('Sexual services and adult content cannot be advertised.', 'Không được quảng cáo dịch vụ tình dục và nội dung người lớn.'),
  banned_drugs: R('Illegal drugs cannot be advertised.', 'Không được quảng cáo ma túy.'),
  banned_counterfeit: R('Counterfeit goods and forged documents cannot be advertised.', 'Không được quảng cáo hàng giả và giấy tờ giả.'),
  banned_wildlife: R('Wildlife and wildlife products cannot be advertised.', 'Không được quảng cáo động vật hoang dã và sản phẩm từ động vật hoang dã.'),
  banned_mlm: R('Multi-level marketing cannot be advertised.', 'Không được quảng cáo kinh doanh đa cấp.'),
  banned_debt_collection: R('Debt-collection services cannot be advertised.', 'Không được quảng cáo dịch vụ đòi nợ.'),
  banned_spy_devices: R('Spy devices and signal jammers cannot be advertised.', 'Không được quảng cáo thiết bị gián điệp và thiết bị gây nhiễu.'),
  banned_visa_legal: R('Visa, immigration and legal-permit services cannot be advertised here.', 'Không được quảng cáo dịch vụ thị thực, xuất nhập cảnh và giấy phép tại đây.'),
  banned_unlawful: R('The ad offers something that is against Vietnamese law.', 'Quảng cáo đưa ra nội dung trái pháp luật Việt Nam.'),
  // ── Art. 8 of the Advertising Law, and misleading claims ───────────────────────────────────────────────────────────
  claim_superlative: R('"Best", "number 1" and similar need proof named in the ad (a ranking, award or survey and its source).', 'Các từ như "nhất", "tốt nhất", "số 1" cần ghi rõ căn cứ trong quảng cáo (xếp hạng, giải thưởng hoặc khảo sát và nguồn).'),
  claim_comparison: R('An ad cannot compare itself directly with a named competitor.', 'Quảng cáo không được so sánh trực tiếp với đối thủ cạnh tranh được nêu tên.'),
  claim_national_symbols: R('An ad cannot use the national flag, emblem, anthem or the images of national leaders.', 'Quảng cáo không được sử dụng quốc kỳ, quốc huy, quốc ca hoặc hình ảnh lãnh đạo Đảng, Nhà nước.'),
  claim_map: R('An ad cannot use a map of Vietnam or its borders, seas or islands.', 'Quảng cáo không được sử dụng bản đồ Việt Nam hoặc biên giới, biển, đảo.'),
  claim_misleading: R('The ad makes a misleading or guaranteed claim (results, cures, profits, "100%").', 'Quảng cáo có nội dung gây hiểu lầm hoặc cam kết chắc chắn (kết quả, chữa khỏi, lợi nhuận, "100%").'),
  content_prohibited: R('The picture or words show something that cannot be advertised under Vietnamese law.', 'Ảnh hoặc nội dung thể hiện hàng hóa, dịch vụ không được quảng cáo theo pháp luật Việt Nam.'),
  // ── Not a verdict ──────────────────────────────────────────────────────────────────────────────────────────────────
  review_unavailable: R('The review could not run just now, so nothing can be paid for. Try again in a few minutes.', 'Hiện chưa thể kiểm duyệt nên chưa thể thanh toán. Hãy thử lại sau vài phút.'),
  review_limit: R('This shop has asked for too many reviews today. Try again tomorrow.', 'Cửa hàng đã gửi quá nhiều yêu cầu kiểm duyệt hôm nay. Hãy thử lại vào ngày mai.'),
  creative_removed: R('eno removed this ad. It cannot run again.', 'eno đã gỡ quảng cáo này. Quảng cáo không thể chạy lại.'),
} as const satisfies Record<string, { en: string; vi: string }>

export type ReviewReasonCode = keyof typeof REVIEW_REASONS

export function reviewReason(code: ReviewReasonCode): ReviewReason {
  return { code, ...REVIEW_REASONS[code] }
}

export const isReviewReasonCode = (c: unknown): c is ReviewReasonCode => typeof c === 'string' && Object.hasOwn(REVIEW_REASONS, c)
