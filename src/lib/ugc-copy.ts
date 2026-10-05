/**
 * What a person reads when the user-generated-content filter refuses their post (App Store gate
 * `ugc-safety`, plan R5 — src/lib/ugc-filter.ts answers 400 `objectionable_content`). Client-safe: no
 * list, no matcher, just the sentence, so every surface says the same thing in both languages.
 *
 * ⚠️ IT NAMES THE KIND OF LANGUAGE, NEVER THE WORD. Echoing the matched term back would turn the refusal
 * into a probe for the list's exact spellings; naming the category is enough for an honest person to
 * see what to rephrase.
 */
type Tr = (en: string, vi: string) => string

export const OBJECTIONABLE_CONTENT = 'objectionable_content'

export function objectionableCopy(surface: 'message' | 'review' | 'reply', tr: Tr): string {
  switch (surface) {
    case 'review':
      return tr(
        'Your review wasn’t posted: it contains language we don’t allow (slurs, threats of violence, sexual solicitation or sexual content involving minors). Please rephrase it.',
        'Đánh giá chưa được đăng vì có lời lẽ không được phép (miệt thị, đe dọa bạo lực, gạ gẫm tình dục hoặc nội dung tình dục liên quan đến trẻ em). Vui lòng viết lại.',
      )
    case 'reply':
      return tr(
        'Your reply wasn’t posted: it contains language we don’t allow (slurs, threats of violence, sexual solicitation or sexual content involving minors). Please rephrase it.',
        'Phản hồi chưa được đăng vì có lời lẽ không được phép (miệt thị, đe dọa bạo lực, gạ gẫm tình dục hoặc nội dung tình dục liên quan đến trẻ em). Vui lòng viết lại.',
      )
    default:
      return tr(
        'Your message wasn’t sent: it contains language we don’t allow (slurs, threats of violence, sexual solicitation or sexual content involving minors). Please rephrase it.',
        'Tin nhắn chưa được gửi vì có lời lẽ không được phép (miệt thị, đe dọa bạo lực, gạ gẫm tình dục hoặc nội dung tình dục liên quan đến trẻ em). Vui lòng viết lại.',
      )
  }
}

/**
 * After the filter refuses a sent chat message: may its text (and its quote) go back into the composer? Only while
 * the composer is still FREE — nothing typed since, and no OTHER reply armed since. Restoring under a newly chosen
 * quote would send this text as a reply to the wrong message (codex, gate round 10). Otherwise the refused message
 * stays as a failed bubble, its words on screen.
 */
export function composerFreeForRefused(typed: string, armedReplyId: string | null | undefined, refusedQuoteId: string | null | undefined): boolean {
  return !typed.trim() && (!armedReplyId || armedReplyId === refusedQuoteId)
}
