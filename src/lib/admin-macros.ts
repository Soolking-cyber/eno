// Pre-prepared moderation messages — the ONLY way an admin messages a user (no free text).
// Each carries EN + VI; the recipient gets it in THEIR language (Profile.locale). Static
// config; promote to a table later if it grows.
export type Macro = { key: string; label: string; en: string; vi: string }

export const MOD_MACROS: Macro[] = [
  {
    // ⛔ NO PROTECTION CLAIM, NO IN-APP PAYMENT (2026-10-05). It said "never pay … outside the app. Keep all
    // contact and payments on eno.vn so you stay protected" — eno takes no payment between users and holds
    // no escrow, so it promised a protection that does not exist and implied an in-app way to pay. It also
    // told users to ignore the phone/Zalo the site itself reveals, and named one site from a codebase that
    // runs two. Now: a universal caution (anyone, any money in advance), a plain statement of what eno does
    // not do, and "the eno team" as the sender on either site.
    key: 'off_platform', label: 'Deposit / prepayment warning',
    en: 'Warning from the eno team: never pay a deposit or send money to anyone before you have checked who they are and what you are paying for. eno does not hold or guarantee payments between users.',
    vi: 'Cảnh báo từ đội ngũ eno: tuyệt đối không đặt cọc hay chuyển tiền cho bất kỳ ai trước khi bạn kiểm tra rõ họ là ai và bạn đang trả tiền cho điều gì. eno không giữ hộ và không bảo đảm các khoản thanh toán giữa người dùng.',
  },
  {
    key: 'need_detail', label: 'Need more detail',
    en: 'Thanks for your report. Could you share more detail (a screenshot or the message) so we can review it faster and more accurately?',
    vi: 'Cảm ơn bạn đã báo cáo. Bạn có thể gửi thêm chi tiết (ảnh chụp màn hình, nội dung tin nhắn) để chúng tôi xử lý nhanh và chính xác hơn không?',
  },
  {
    key: 'removed_policy', label: 'Listing removed — policy',
    en: 'Your listing was removed for breaking eno.vn policy. Please edit it to follow the rules and post again.',
    vi: 'Tin đăng của bạn đã bị gỡ vì vi phạm chính sách eno.vn. Vui lòng chỉnh sửa cho đúng quy định rồi đăng lại.',
  },
  {
    key: 'account_warning', label: 'Account warning',
    en: 'This is a warning from eno.vn about activity on your account. A further violation may restrict your account from posting.',
    vi: 'Đây là cảnh báo từ eno.vn về hoạt động trên tài khoản của bạn. Vi phạm tiếp theo có thể khiến tài khoản bị hạn chế đăng tin.',
  },
  {
    key: 'resolved_thanks', label: 'Resolved — thanks',
    en: 'Thanks for your report. We have reviewed and handled it. eno.vn is safer thanks to you!',
    vi: 'Cảm ơn bạn đã báo cáo. Chúng tôi đã xem xét và xử lý. eno.vn an toàn hơn nhờ có bạn!',
  },
]

// We only have EN + VI macros. Send Vietnamese ONLY when the user's stored language is
// explicitly 'vi'; everyone else (English, any other language, or unknown) gets English —
// the safe international fallback, so an English user never receives Vietnamese.
export function pickLocale(locale: string | null | undefined): 'en' | 'vi' {
  return locale === 'vi' ? 'vi' : 'en'
}

// Auto-sent to the reported party when a report is CONFIRMED — links to the appeal form.
export const APPEAL_NOTICE = {
  title: { en: 'Action taken on your content', vi: 'Nội dung của bạn đã bị xử lý' },
  body: {
    en: 'Your content was actioned for a policy violation on eno.vn. If you believe this is a mistake, you can appeal with proof.',
    vi: 'Nội dung của bạn đã bị xử lý do vi phạm chính sách eno.vn. Nếu bạn cho rằng đây là nhầm lẫn, bạn có thể khiếu nại kèm bằng chứng.',
  },
}

// Resolve a macro to the recipient's language; null if the key is unknown.
export function localizedMacro(key: string, locale: string | null | undefined): string | null {
  const m = MOD_MACROS.find((x) => x.key === key)
  return m ? m[pickLocale(locale)] : null
}
