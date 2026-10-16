import { renderBrandEmail, esc, EMAIL } from './layout'
import type { PhotoReason } from '@/lib/teachers/photo-check'

/**
 * "PLEASE CHANGE YOUR PROFILE PHOTO" (owner, 2026-10-16: "ask current ones to reupload the ones that dont have face or
 * unrelated to image") — sent once per teacher per photo by /api/cron/teacher-photo-recheck, in the app and by email.
 * A SERVICE NOTICE about their own profile: no unsubscribe link, nothing promotional. Nobody is hidden for it — it asks.
 * In the teacher's language. Says what was found (no face / not a photo), what is fine (a photo with their class), and
 * the human route (the Help page) for a teacher who thinks the check got it wrong.
 */
export const TEACHER_PHOTO_ASK = {
  title: {
    en: 'Please change your profile photo',
    vi: 'Vui lòng đổi ảnh hồ sơ',
  },
  why: {
    no_face: {
      en: 'We can’t see your face in your teacher profile photo.',
      vi: 'Chúng tôi không thấy khuôn mặt của bạn trong ảnh hồ sơ giáo viên.',
    },
    not_photo: {
      en: 'Your teacher profile photo looks like a drawing, a character or a graphic rather than a photo of you.',
      vi: 'Ảnh hồ sơ giáo viên của bạn trông giống hình vẽ, nhân vật hoặc hình đồ họa hơn là ảnh của bạn.',
    },
  } satisfies Record<PhotoReason, { en: string; vi: string }>,
  ask: {
    en: 'Schools want to see who they are writing to — please upload a photo that shows your face. A photo of you teaching your class is fine. Your profile stays visible meanwhile.',
    vi: 'Các trường muốn thấy người họ đang nhắn tin — hãy tải lên một ảnh có khuôn mặt của bạn. Ảnh bạn đang dạy lớp cũng được. Trong lúc đó, hồ sơ của bạn vẫn hiển thị.',
  },
  wrong: {
    en: 'Think we got it wrong? Tell us from the Help page and a person will look at it.',
    vi: 'Bạn cho rằng chúng tôi nhầm? Hãy báo cho chúng tôi từ trang Trợ giúp và nhân viên sẽ xem lại.',
  },
} as const

/** Where the photo is changed: the edit form's last step. */
export const TEACHER_PHOTO_ASK_PATH = '/teachers/edit?step=finish'

export function teacherPhotoAskBody(reason: PhotoReason, l: 'en' | 'vi'): string {
  return `${TEACHER_PHOTO_ASK.why[reason][l]} ${TEACHER_PHOTO_ASK.ask[l]} ${TEACHER_PHOTO_ASK.wrong[l]}`
}

export function renderTeacherPhotoAsk(opts: { origin: string; siteName: string; recipientName?: string | null; locale?: 'en' | 'vi'; reason: PhotoReason }): { subject: string; html: string; text: string } {
  const { origin, siteName, recipientName, reason } = opts
  const l = opts.locale === 'vi' ? 'vi' : 'en'
  const subject = l === 'vi' ? `Vui lòng đổi ảnh hồ sơ giáo viên trên ${siteName}` : `Please change your teacher profile photo on ${siteName}`
  const hello = recipientName ? (l === 'vi' ? `Chào ${recipientName},` : `Hi ${recipientName},`) : (l === 'vi' ? 'Chào bạn,' : 'Hi,')
  const lines = [TEACHER_PHOTO_ASK.why[reason][l], TEACHER_PHOTO_ASK.ask[l], TEACHER_PHOTO_ASK.wrong[l]]
  const E = EMAIL
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${E.INK};">${esc(s)}</p>`
  const url = `${origin}${TEACHER_PHOTO_ASK_PATH}`
  // ⚠️ bodyHtml is the card's CONTENT ROWS (layout.ts): one row, as teacher-messages.ts does.
  const html = renderBrandEmail({
    preheader: lines[0],
    bodyHtml: `<tr><td style="padding:4px 24px 8px;">${p(hello)}${lines.map(p).join('')}</td></tr>`,
    origin,
    cta: { label: l === 'vi' ? 'Đổi ảnh của tôi' : 'Change my photo', url },
    audienceNote: l === 'vi' ? `Bạn nhận được email này vì bạn có hồ sơ giáo viên trên ${siteName}.` : `You’re receiving this because you have a teacher profile on ${siteName}.`,
    sender: 'full',
  })
  const text = [hello, '', ...lines, '', url].join('\n')
  return { subject, html, text }
}
