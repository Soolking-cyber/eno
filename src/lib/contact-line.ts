/**
 * THE LINE UNDER "Chat now" — what the tap does and how contact works, in one sentence (ContactComposer's `safetyLine`).
 *
 * One source for its two places: under the button (ContactComposer, every width) and, on the goods sheet whose action is
 * pinned, once in the page below md — the seller band's last line (owner-approved 2026-11-15 (build 7), cook r07 "item":
 * the pinned tier is the button alone; page.tsx `tierLine`). A PLAIN MODULE (no 'use client'): the client composer passes its
 * string `tr`, the server page its <Bilingual> one, so both print the same words in the same language.
 *
 * ⚠️ LITERAL PAIRS INSIDE `tr(…)`: scripts/gen-ui-strings.mjs harvests quoted arguments only.
 *   · 'plan' — eno's own trip desk: stranger-safety advice is irrelevant there; it says what the tap does, and that it is free.
 *   · 'partner' — ⛔ A PARTNER NEVER SHARES A NUMBER (phoneForSeller returns null, the reveal route refuses it): the line says
 *     what does happen instead (contact-composer.tsx `sellerIsPartner`).
 *   · 'person' — every other seller: the number is asked for once they reply.
 */
export type ContactLineKind = 'plan' | 'partner' | 'person'

export function contactLine<R>(kind: ContactLineKind, tr: (en: string, vi: string) => R): R {
  if (kind === 'plan') return tr('Free — you answer a few questions in the chat and get a day-by-day plan.', 'Miễn phí — bạn trả lời vài câu hỏi trong khung chat và nhận lịch trình theo từng ngày.')
  if (kind === 'partner') return tr('Partners answer in eno chat. No phone number is shared.', 'Đối tác trả lời qua chat trên eno. Không chia sẻ số điện thoại.')
  return tr('Request their number once they reply — one number works for both Zalo and WhatsApp.', 'Yêu cầu số điện thoại sau khi họ trả lời — một số dùng được cho cả Zalo và WhatsApp.')
}
