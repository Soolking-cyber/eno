/**
 * What each classroom API refusal means to the person who hit it — one place, EN + VI (rendered with tr()). A code not
 * listed falls back to the generic line; nothing technical ever reaches the screen.
 */
type Pair = { en: string; vi: string }

const COPY: Record<string, Pair> = {
  network: { en: 'No connection. Check your internet and try again.', vi: 'Không có kết nối. Hãy kiểm tra Internet và thử lại.' },
  auth_required: { en: 'Please sign in first.', vi: 'Vui lòng đăng nhập trước.' },
  classroom_closed: { en: 'eno Classroom is in a small pilot and is not open for this class yet.', vi: 'eno Classroom đang thử nghiệm và chưa mở cho lớp này.' },
  teacher_profile_required: { en: 'Create your teacher profile first.', vi: 'Hãy tạo hồ sơ giáo viên trước.' },
  avatar_required: { en: 'Create your avatar first.', vi: 'Hãy tạo avatar của bạn trước.' },
  name_required: { en: 'Give your avatar a name.', vi: 'Hãy đặt tên cho avatar.' },
  voice_invalid: { en: 'Pick a voice.', vi: 'Hãy chọn một giọng nói.' },
  look_invalid: { en: 'Pick a look for your avatar.', vi: 'Hãy chọn diện mạo cho avatar.' },
  photo_required: { en: 'Add a photo to your teacher profile first.', vi: 'Hãy thêm ảnh vào hồ sơ giáo viên trước.' },
  likeness_deleting: { en: 'We are still deleting the likeness from your last request. Try again in a day or two.', vi: 'Chúng tôi vẫn đang xoá hình mẫu từ yêu cầu trước của bạn. Hãy thử lại sau một hai ngày.' },
  contact_in_text: { en: 'Remove phone numbers, emails and links from the text.', vi: 'Hãy xoá số điện thoại, email và đường link khỏi nội dung.' },
  banned_words: { en: 'The text contains a word we do not allow. Please reword it.', vi: 'Nội dung có từ không được phép. Hãy viết lại.' },
  seat_name_required: { en: 'Give the student a name or label.', vi: 'Hãy nhập tên hoặc nhãn cho học viên.' },
  seat_limit: { en: 'Your class is full for the pilot.', vi: 'Lớp của bạn đã đủ chỗ trong giai đoạn thử nghiệm.' },
  seat_not_found: { en: 'This student is no longer in the class.', vi: 'Học viên này không còn trong lớp.' },
  invite_invalid: { en: 'This invite link has expired or was already used. Ask your teacher for a new one.', vi: 'Link mời đã hết hạn hoặc đã được dùng. Hãy xin giáo viên link mới.' },
  invite_own: { en: 'This is an invite to your own class.', vi: 'Đây là link mời vào lớp của chính bạn.' },
  already_enrolled: { en: 'This learner is already in this class.', vi: 'Học viên này đã ở trong lớp.' },
  birth_year_invalid: { en: 'Check the year of birth — children aged 3 to 17.', vi: 'Hãy kiểm tra năm sinh — trẻ từ 3 đến 17 tuổi.' },
  learner_limit: { en: 'You have added the most children we allow.', vi: 'Bạn đã thêm tối đa số trẻ cho phép.' },
  learner_not_found: { en: 'This learner was not found.', vi: 'Không tìm thấy học viên.' },
  assent_required: { en: 'The child needs to say yes first.', vi: 'Trẻ cần đồng ý trước.' },
  consent_required: { en: 'Please agree to the practice terms again.', vi: 'Vui lòng đồng ý lại với điều khoản luyện tập.' },
  notice_changed: { en: 'The terms just changed. Please read them again.', vi: 'Điều khoản vừa thay đổi. Vui lòng đọc lại.' },
  seat_inactive: { en: 'Practice is paused for this class. Ask your teacher.', vi: 'Lớp đang tạm dừng luyện tập. Hãy hỏi giáo viên.' },
  session_live: { en: 'A practice session is already running in another class.', vi: 'Một buổi luyện đang diễn ra ở lớp khác.' },
  session_over: { en: 'This session has ended.', vi: 'Buổi luyện đã kết thúc.' },
  session_not_found: { en: 'This session was not found.', vi: 'Không tìm thấy buổi luyện.' },
  week_limit: { en: 'You have practised every session for this week. Great work!', vi: 'Bạn đã luyện đủ các buổi trong tuần. Làm tốt lắm!' },
  day_limit: { en: 'You have practised today. Come back tomorrow!', vi: 'Hôm nay bạn đã luyện rồi. Hẹn gặp lại ngày mai!' },
  test_limit: { en: 'You have used today’s test sessions.', vi: 'Bạn đã dùng hết lượt thử hôm nay.' },
  budget_classroom: { en: 'The classroom has reached its practice limit for now. Please try later.', vi: 'Lớp học đã đạt giới hạn luyện tập. Vui lòng thử lại sau.' },
  budget_teacher: { en: 'This class has used its practice minutes for the month.', vi: 'Lớp đã dùng hết số phút luyện tập trong tháng.' },
  turn_cap: { en: 'That is a long session! Tap End to see your report.', vi: 'Buổi luyện dài quá! Chạm Kết thúc để xem nhận xét.' },
  turn_in_progress: { en: 'Still answering your last turn…', vi: 'Vẫn đang trả lời lượt trước…' },
  audio_invalid: { en: 'That recording did not work. Try again.', vi: 'Bản ghi âm bị lỗi. Hãy thử lại.' },
  speech_unavailable: { en: 'Could not hear that just now. Please try again.', vi: 'Chưa nghe được. Vui lòng thử lại.' },
  camera_blocked: { en: 'The camera is blocked — allow it for this site in your browser settings.', vi: 'Camera đang bị chặn — hãy cho phép camera cho trang này trong cài đặt trình duyệt.' },
  camera_unsupported: { en: 'This browser cannot show your camera. Open the page in Safari or Chrome.', vi: 'Trình duyệt này không hiện được camera. Hãy mở trang bằng Safari hoặc Chrome.' },
  camera_unavailable: { en: 'The camera could not start. Check that no other app is using it.', vi: 'Không bật được camera. Hãy kiểm tra xem ứng dụng khác có đang dùng camera không.' },
  tutor_unavailable: { en: 'The avatar is thinking too long. Please say it again.', vi: 'Avatar đang nghĩ hơi lâu. Bạn nói lại nhé.' },
  ai_unavailable: { en: 'Writing with AI is not available right now. Try again later.', vi: 'Tính năng viết bằng AI tạm thời chưa dùng được. Hãy thử lại sau.' },
  ai_failed: { en: 'The AI could not write it this time. Try again, or write it yourself.', vi: 'AI chưa viết được lần này. Hãy thử lại hoặc tự viết.' },
  rate_limited: { en: 'Too many tries. Please wait a little.', vi: 'Bạn đã thử quá nhiều lần. Vui lòng đợi một chút.' },
  persona_stale: { en: 'You changed the name or the character while the AI was writing, so its draft was not used. Tap Write with AI again.', vi: 'Bạn đã đổi tên hoặc tính cách khi AI đang viết, nên bản nháp không được dùng. Hãy chạm Viết bằng AI lần nữa.' },
  plan_changed: { en: 'A newer plan arrived. Here it is — check it again.', vi: 'Có kế hoạch mới hơn. Hãy xem lại.' },
}

const FALLBACK: Pair = { en: 'Something went wrong. Please try again.', vi: 'Đã có lỗi. Vui lòng thử lại.' }

export function refusalCopy(code: string): Pair {
  return COPY[code] ?? FALLBACK
}

/**
 * A session's day as the reader sees it — in the APP's language and Vietnam's time zone, never the browser's (C3a review,
 * Opus: `toLocaleDateString(undefined)` followed the phone's own locale). "Sun 25 Oct" / "CN, 25 thg 10";
 * long: "Sunday 25 October" / "Chủ Nhật, 25 tháng 10".
 */
export function sessionDate(iso: string, lang: string, style: 'short' | 'long' = 'short'): string {
  try {
    return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', {
      weekday: style, day: 'numeric', month: style, timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

/** "Thursday" / "Thứ Năm" — the day a learner may practise again (Asia/Ho_Chi_Minh). */
export function dayName(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', { weekday: 'long', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(iso))
  } catch {
    return ''
  }
}
