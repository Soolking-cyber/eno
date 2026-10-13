import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'

/**
 * The first message a school sends a teacher in one tap (owner, 2026-10-12: "currently its for products 'is it still
 * available' which is not fit to reach out to a teacher — need new quick messaging for teachers specifically").
 *
 * ⛔ A TEACHER IS NOT AN ITEM FOR SALE: no "is this still available?", no price. A business account speaks as the school
 * that is hiring (src/lib/openers.ts 'commit.hire' reads the same way); since the teacher DM ladder let ANY account
 * write (owner, 2026-10-13), a personal account speaks for itself — "I am looking for a teacher" — never "we are hiring"
 * on behalf of a school it is not. A cover lesson is asked by a business only (the contact block offers it to nobody
 * else: the guides call cover work lawful only for the employer holding the work permit), so the person voice has no
 * cover opener. One source for every one-tap
 * door to a teacher: the profile's contact block (src/components/teachers/teacher-contact.tsx) and the chat button of
 * the listing card, the list row and the video feed — all of which used to send the product opener to a teacher too.
 *
 * `tr` is the caller's language function. The copy sits in literal `tr('…', '…')` calls so the pre-warm catalogue
 * harvest (scripts/gen-ui-strings.mjs) sees it; no apostrophes in the English halves for the same reason.
 */
type Tr = (en: string, vi: string) => string

/** The voice of the account that writes: a business speaks as the school, anyone else as a person. */
export type OpenerVoice = 'school' | 'person'
export const openerVoice = (accountType: string | null | undefined): OpenerVoice => (accountType === 'business' ? 'school' : 'person')

/** The first words to a teacher: a school hiring or asking for a cover lesson, or a person looking for a teacher. */
// ⛔ The default voice is the PERSON's (gate review, 2026-10-13): a caller that forgets to pass one sends the neutral
// opener, true for a school too — never "we are hiring" in a person's mouth.
export function teacherOpener(tr: Tr, kind: 'hire' | 'cover' = 'hire', voice: OpenerVoice = 'person'): string {
  if (voice === 'person') return tr('Hello, I am looking for a teacher and your profile looks like a good fit — are you open to talking?', 'Xin chào, mình đang tìm giáo viên và hồ sơ của bạn rất phù hợp — bạn có muốn trao đổi thêm không?')
  return kind === 'cover'
    ? tr('Hello, we need a cover teacher — could you cover a lesson for us? We will send the day, time and place next.', 'Xin chào, chúng tôi cần giáo viên dạy thay — bạn có thể dạy thay một buổi cho chúng tôi không? Chúng tôi sẽ gửi ngày, giờ và địa điểm ngay sau đây.')
    : tr('Hello, we are hiring a teacher and your profile looks like a good fit — are you open to talking?', 'Xin chào, chúng tôi đang tuyển giáo viên và hồ sơ của bạn rất phù hợp — bạn có muốn trao đổi thêm không?')
}

/** The one-tap chat's first message on any listing: a teacher is hired; anything else is asked after. */
export function quickChatOpener(listingType: string | null | undefined, tr: Tr, voice: OpenerVoice = 'person'): string {
  return listingType === TEACHER_LISTING_TYPE ? teacherOpener(tr, 'hire', voice) : tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?')
}
