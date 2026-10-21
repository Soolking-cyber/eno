/**
 * In-app calls — the words for every refusal, failure and ending the call UI can show. One table, so the call
 * button, the ring screen and the end screen never word the same code two ways. `tr` is the language context's.
 */
type Tr = (en: string, vi?: string) => string

export function callErrorText(code: string | null | undefined, tr: Tr): string {
  switch (code) {
    case 'calls_not_verified': return tr('Verify your identity to make calls.', 'Xác minh danh tính để gọi.')
    case 'calls_peer_not_verified': return tr('Video calls, and calls about teaching, need both people verified.', 'Gọi video và gọi về việc dạy học cần cả hai người đã xác minh.')
    case 'calls_consent_required': return tr('They have not allowed calls from you yet.', 'Người này chưa cho phép bạn gọi.')
    case 'calls_cooldown':
    case 'rate_limited': return tr('Too many calls for now — try again later.', 'Đã gọi quá nhiều lần — vui lòng thử lại sau.')
    case 'call_in_progress': return tr('You are already in a call.', 'Bạn đang trong một cuộc gọi khác.')
    case 'call_gone': return tr('This call has ended.', 'Cuộc gọi này đã kết thúc.')
    case 'protocol_mismatch': return tr('Reload the page to call — one of you has an older version of eno.', 'Tải lại trang để gọi — một trong hai người đang dùng phiên bản eno cũ.')
    case 'relay_unavailable': return tr('Calls are briefly unavailable. Please try again in a minute.', 'Cuộc gọi tạm thời gián đoạn. Vui lòng thử lại sau ít phút.')
    case 'blocked': return tr('You cannot call this person.', 'Bạn không thể gọi cho người này.')
    case 'media_denied': return tr('Allow microphone access in your browser to call.', 'Hãy cho phép trình duyệt dùng micro để gọi.')
    case 'media_no_device': return tr('No microphone or camera was found.', 'Không tìm thấy micro hoặc camera.')
    case 'media_in_use': return tr('Your microphone or camera is being used by another app.', 'Micro hoặc camera đang được ứng dụng khác sử dụng.')
    case 'media_insecure':
    case 'media_unsupported': return tr('This browser cannot make calls. Try Chrome or Safari.', 'Trình duyệt này không gọi được. Hãy thử Chrome hoặc Safari.')
    case 'calls_unavailable':
    case 'calls_thread_unavailable': return tr('Calls are not available in this conversation.', 'Cuộc trò chuyện này không hỗ trợ gọi.')
    default: return tr('The call could not be started. Please try again.', 'Không bắt đầu được cuộc gọi. Vui lòng thử lại.')
  }
}

export function callEndText(reason: string | null | undefined, role: 'caller' | 'callee' | null, tr: Tr): string {
  switch (reason) {
    case 'declined':
    case 'unavailable':
    case 'missed': return role === 'callee' ? tr('Missed call', 'Cuộc gọi nhỡ') : tr('No answer', 'Không có người nghe')
    case 'cancelled': return role === 'callee' ? tr('Missed call', 'Cuộc gọi nhỡ') : tr('Call cancelled', 'Đã hủy cuộc gọi')
    case 'lost': return tr('The connection was lost.', 'Mất kết nối.')
    case 'media_failed': return tr('The call could not connect.', 'Không kết nối được cuộc gọi.')
    case 'kill_switch': return tr('Calls are paused for now.', 'Tính năng gọi đang tạm dừng.')
    case 'cap_reached': return tr('Calls end after 2 hours.', 'Cuộc gọi tự kết thúc sau 2 giờ.')
    case 'protocol_mismatch': return tr('Reload the page to call — one of you has an older version of eno.', 'Tải lại trang để gọi — một trong hai người đang dùng phiên bản eno cũ.')
    default: return tr('Call ended', 'Cuộc gọi đã kết thúc')
  }
}

/**
 * A translated template with a {name} slot, filled. The extractor sees the template, so every language gets it; a
 * translation that lost the slot falls back to the English one rather than dropping the name (same-seller-shelf.tsx).
 */
export function withName(template: string, englishTemplate: string, name: string): string {
  return (template.includes('{name}') ? template : englishTemplate).replace('{name}', () => name)
}

/** "Buyer of <listing>" / "Seller of <listing>" — the ring screen's first line about who this is (§4). */
export function callerRoleLine(side: 'buyer' | 'seller' | null, listingTitle: string | null, tr: Tr): string | null {
  if (!listingTitle) return null
  if (side === 'buyer') return `${tr('Interested in', 'Quan tâm đến')} ${listingTitle}`
  if (side === 'seller') return `${tr('Listed', 'Người đăng')} · ${listingTitle}`
  return listingTitle
}
