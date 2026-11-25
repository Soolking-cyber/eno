/**
 * The call rows' fixed words, stored bilingual "VI · EN" (src/lib/calls/server/cards.ts writes them). CLIENT-SAFE, so the
 * thread page can show each reader their own half (src/lib/chat-phrases.ts) — cards.ts is server-only.
 */
export const CALL_DONE_LINE = '📞 Cuộc gọi · Call'
export const CALL_MISSED_LINE = '📞 Cuộc gọi nhỡ · Missed call'
export const CALL_FAILED_LINE = "📞 Cuộc gọi không kết nối được · Call didn't connect"
export const CALL_REQUEST_TEXT = '📞 Muốn gọi cho bạn · Would like to call you'
/** The lock-screen ring and the pushes that replace it (cards.ts), and the missed-call bell row. */
export const RING_TEXT = 'Cuộc gọi đến · Incoming call'
export const MISSED_TEXT = 'Cuộc gọi nhỡ · Missed call'
export const ANSWERED_TEXT = 'Đã trả lời · Answered'
export const RING_OVER_TEXT = 'Cuộc gọi đã kết thúc · Call ended'
