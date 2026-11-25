/**
 * The fixed lines a teacher thread posts for a tap (share contact, stop sharing, send / stop / ask for the intro video).
 * Stored bilingual "VI · EN" like every server-written chat line; the thread shows each reader their own half
 * (src/lib/chat-phrases.ts). CLIENT-SAFE — the routes that post them and the page that reads them share these constants.
 */
export const TEACHER_SHARED_PHONE_LINE = '📇 Đã chia sẻ số điện thoại, email và CV · Shared my phone, email and CV'
export const TEACHER_SHARED_LINE = '📇 Đã chia sẻ email và CV · Shared my email and CV'
export const TEACHER_SHARE_STOPPED_LINE = '🔒 Đã ngừng chia sẻ liên hệ · Stopped sharing my contact details'
export const TEACHER_VIDEO_SENT_LINE = '🎬 Đã gửi video giới thiệu · Sent my intro video'
export const TEACHER_VIDEO_STOPPED_LINE = '🎬 Đã ngừng chia sẻ video giới thiệu · Stopped sharing my intro video'
export const TEACHER_VIDEO_ASK_LINE = '🎬 Bạn có thể gửi video giới thiệu không? · Could you send your intro video?'
