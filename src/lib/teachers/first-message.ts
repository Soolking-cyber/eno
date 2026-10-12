import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'

/**
 * The first message a school sends a teacher in one tap (owner, 2026-10-12: "currently its for products 'is it still
 * available' which is not fit to reach out to a teacher — need new quick messaging for teachers specifically").
 *
 * ⛔ A TEACHER IS NOT AN ITEM FOR SALE: no "is this still available?", no price. The school is the one hiring, so the
 * school speaks as the recruiter (src/lib/openers.ts 'commit.hire' reads the same way). One source for every one-tap
 * door to a teacher: the profile's contact block (src/components/teachers/teacher-contact.tsx) and the chat button of
 * the listing card, the list row and the video feed — all of which used to send the product opener to a teacher too.
 *
 * `tr` is the caller's language function. The copy sits in literal `tr('…', '…')` calls so the pre-warm catalogue
 * harvest (scripts/gen-ui-strings.mjs) sees it; no apostrophes in the English halves for the same reason.
 */
type Tr = (en: string, vi: string) => string

/** A school's first words to a teacher: hiring, or (to a teacher who offers them) a cover lesson. */
export function teacherOpener(tr: Tr, kind: 'hire' | 'cover' = 'hire'): string {
  return kind === 'cover'
    ? tr('Hello, we need a cover teacher — could you cover a lesson for us? We will send the day, time and place next.', 'Xin chào, chúng tôi cần giáo viên dạy thay — bạn có thể dạy thay một buổi cho chúng tôi không? Chúng tôi sẽ gửi ngày, giờ và địa điểm ngay sau đây.')
    : tr('Hello, we are hiring a teacher and your profile looks like a good fit — are you open to talking?', 'Xin chào, chúng tôi đang tuyển giáo viên và hồ sơ của bạn rất phù hợp — bạn có muốn trao đổi thêm không?')
}

/** The one-tap chat's first message on any listing: a teacher is hired; anything else is asked after. */
export function quickChatOpener(listingType: string | null | undefined, tr: Tr): string {
  return listingType === TEACHER_LISTING_TYPE ? teacherOpener(tr) : tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?')
}
