// ── What the app says when the teacher DM ladder refuses a new chat (owner, 2026-10-13) ──────────────────────────────
//
// Client-safe (type-only imports), shared by the pending-message page (every one-tap door: card, list row, video feed,
// profile) and the teacher profile's contact block, so the two never word the same refusal twice. The server sends the
// facts (src/lib/teachers/dm-quota.ts teacherDmRefusal: tier, limit, next, reason, resetAt); this turns them into a
// sentence and the one step that lifts the limit.
//
// ⚠️ `tr(en, vi)` WITH LITERAL ARGUMENTS, NO APOSTROPHES IN THE ENGLISH: scripts/gen-ui-strings.mjs harvests single-
// quoted literals only. The numbers are typed into the sentences for the same reason — dm-limit-copy.test.ts holds them
// equal to TEACHER_DM_LIMITS / TEACHER_UNANSWERED_MAX, so a changed limit fails a test instead of shipping a stale number.

import type { TeacherDmNext, TeacherDmTier } from '@/lib/teachers/constants'
import { IDENTITY_VERIFY_PATH } from '@/lib/identity-block-copy'

type Tr = (en: string, vi: string) => string

export type TeacherDmRefusalFacts = { tier?: TeacherDmTier | string; next?: TeacherDmNext | string; reason?: string | null }

/** The sentence for a refusal; null when the facts are not a ladder refusal (an older server's bare code). */
export function teacherDmLimitMessage(f: TeacherDmRefusalFacts, tr: Tr): string | null {
  if (f.tier === 'revoked') return tr('You cannot start new chats with teachers from this account. Check your email for the details.', 'Tài khoản này không thể bắt đầu trò chuyện mới với giáo viên. Vui lòng xem email để biết chi tiết.')
  if (f.reason === 'phone') return tr('Add and confirm your phone number to message teachers, or verify your identity.', 'Hãy thêm và xác nhận số điện thoại để nhắn tin cho giáo viên, hoặc xác minh danh tính.')
  if (f.reason === 'pool') return tr('Several accounts on this internet connection have started chats with teachers today. Verify your identity to keep going, or try again after midnight.', 'Hôm nay đã có nhiều tài khoản trên cùng kết nối internet này bắt đầu trò chuyện với giáo viên. Hãy xác minh danh tính để tiếp tục, hoặc thử lại sau nửa đêm.')
  if (f.tier === 'unverified') {
    if (f.next === 'identity_pending') return tr('You can start chats with up to 3 new teachers a day. Your identity check is being reviewed; once it is approved the limit rises to 10.', 'Mỗi ngày bạn có thể bắt đầu trò chuyện với tối đa 3 giáo viên mới. Hồ sơ xác minh danh tính của bạn đang được xem xét; khi được duyệt, giới hạn sẽ tăng lên 10.')
    if (f.next === 'renew_identity') return tr('You can start chats with up to 3 new teachers a day. Your identity document has expired; verify again to raise this to 10.', 'Mỗi ngày bạn có thể bắt đầu trò chuyện với tối đa 3 giáo viên mới. Giấy tờ tùy thân của bạn đã hết hạn; hãy xác minh lại để nâng lên 10.')
    return tr('You can start chats with up to 3 new teachers a day. Verify your identity to raise this to 10, or start more after midnight.', 'Mỗi ngày bạn có thể bắt đầu trò chuyện với tối đa 3 giáo viên mới. Xác minh danh tính để nâng lên 10, hoặc bắt đầu thêm sau nửa đêm.')
  }
  if (f.tier === 'identity') {
    if (f.next === 'verify_business') return tr('You can start chats with up to 10 new teachers a day. Verify your business to raise this to 30.', 'Mỗi ngày bạn có thể bắt đầu trò chuyện với tối đa 10 giáo viên mới. Xác minh doanh nghiệp để nâng lên 30.')
    if (f.next === 'business_pending') return tr('You can start chats with up to 10 new teachers a day. Your business verification is being reviewed; once it is approved the limit rises to 30.', 'Mỗi ngày bạn có thể bắt đầu trò chuyện với tối đa 10 giáo viên mới. Hồ sơ xác minh doanh nghiệp của bạn đang được xem xét; khi được duyệt, giới hạn sẽ tăng lên 30.')
    if (f.next === 'renew_business') return tr('You can start chats with up to 10 new teachers a day. Your business verification has lapsed; renew it to raise this to 30.', 'Mỗi ngày bạn có thể bắt đầu trò chuyện với tối đa 10 giáo viên mới. Xác minh doanh nghiệp của bạn đã hết hiệu lực; hãy gia hạn để nâng lên 30.')
    return tr('You can start chats with up to 10 new teachers a day. A verified business account can start up to 30.', 'Mỗi ngày bạn có thể bắt đầu trò chuyện với tối đa 10 giáo viên mới. Tài khoản doanh nghiệp đã xác minh có thể bắt đầu tối đa 30.')
  }
  if (f.tier === 'business') return tr('You have started chats with 30 new teachers today, the most allowed. You can start more after midnight (Vietnam time).', 'Hôm nay bạn đã bắt đầu trò chuyện với 30 giáo viên mới, mức tối đa. Bạn có thể bắt đầu thêm sau nửa đêm (giờ Việt Nam).')
  return null
}

export type TeacherDmStep = { label: string; href: string; kyc: 'identity' | 'business' | null }

/**
 * The one step that lifts the limit, or null (the top rung waits for tomorrow; revoked has no way up). `accountType` is
 * the viewer's: an account that never chose one goes to /onboard to become a business.
 * ⚠️ In the iOS app with `ios-hide-kyc` on, a `kyc` step must not render as a link — callers show the plain-text
 * IosVerifyElsewhereNote / iosVerifyElsewhereText instead (src/components/marketplace/ios-browser-only-note.tsx).
 */
export function teacherDmStep(next: TeacherDmNext | string | undefined, accountType: string | null | undefined, tr: Tr): TeacherDmStep | null {
  switch (next) {
    case 'verify_identity':
    case 'renew_identity':
      return { label: tr('Verify your identity', 'Xác minh danh tính'), href: IDENTITY_VERIFY_PATH, kyc: 'identity' }
    case 'identity_pending':
      return { label: tr('See your verification', 'Xem trạng thái xác minh'), href: IDENTITY_VERIFY_PATH, kyc: 'identity' }
    case 'switch_to_business':
      return accountType
        ? { label: tr('Switch to a business account', 'Chuyển sang tài khoản doanh nghiệp'), href: '/dashboard/settings?tab=account', kyc: null }
        : { label: tr('Set up a business account', 'Tạo tài khoản doanh nghiệp'), href: '/onboard', kyc: null }
    case 'verify_business':
    case 'renew_business':
      return { label: tr('Verify your business', 'Xác minh doanh nghiệp'), href: '/dashboard/verification', kyc: 'business' }
    case 'business_pending':
      return { label: tr('See your verification', 'Xem trạng thái xác minh'), href: '/dashboard/verification', kyc: 'business' }
    case 'add_phone':
      return { label: tr('Add your phone number', 'Thêm số điện thoại'), href: '/dashboard/settings?tab=account', kyc: null }
    default:
      return null
  }
}

/** A teacher who has not answered: what the writer is told when a third message is refused (`teacher_awaiting_reply`). */
export function teacherAwaitingReplyMessage(tr: Tr): string {
  return tr('The teacher has not replied yet. You can send up to 2 messages until they do.', 'Giáo viên chưa trả lời. Bạn có thể gửi tối đa 2 tin nhắn cho đến khi giáo viên trả lời.')
}
