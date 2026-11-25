import { TWO_LANGS, half, localizeSystemLine } from './chat-lines'
import { OPENER_TEXTS, type Bilingual } from './openers'
import { quickChatOpener, teacherOpener } from './teachers/first-message'
import { JOB_DM_KEEP_TEXTS, JOB_DM_STOP_TEXTS } from './teachers/job-dms/replies'

/**
 * ⛔ EVERY CHAT LINE ENO WROTE READS IN THE READER'S OWN LANGUAGE (owner, 2026-11-25: "it should respond in vietnamese to
 * vietnamese buyers each person in their languages all auto messages in eno.vn app"). CLIENT-SAFE, no db.
 *
 * Two kinds of eno-written words land in a thread:
 * 1. SYSTEM LINES — posted by the server for a tap or an event (the partner welcome, "Buy now", an accepted or declined
 *    offer, a call, a teacher sharing their contact or video). Stored "VI · EN" so an older build, an agent and an admin
 *    reading a report all see readable words; each reader is shown their own half, plus whatever the line carries after
 *    it (" — 2.000.000 đ", " · 3:12").
 * 2. ONE-TAP PHRASES — eno's chip and opener sentences ("Hi! Is this still available?", "Price is firm"), sent in the
 *    SENDER's language. Machine translation got them wrong ("Chào bạn! Món này còn không?" → "Is this dish still
 *    available?", 2026-11-25), and eno already holds the right words in both languages. So a body that is exactly one
 *    half of a pair is shown in the reader's half.
 * Either way the line is never machine-translated (use-chat-translation.ts, api/messages/translate) — for an English or
 * Vietnamese reader. A reader in one of the nine machine-translated languages is left exactly as before (null here).
 *
 * ⛔ ONLY ENO'S OWN WORDS ARE MATCHED (commit gate, 2026-11-25). A line plus a person's text after it ("Trả giá · Offered
 * 4.500.000 ₫ — could you do 4.5M?", or a copied line with a phone number typed after it) is NOT a fixed line: it keeps its
 * translation and its "Show original". What may follow a system line is an amount or a call's length, nothing else.
 * Where a person's note does follow and is never translated anyway (the bell's offer rows, a push), localizeLineHead
 * swaps the line's head alone.
 *
 * ⚠️ A NEW SYSTEM LINE OR A NEW ONE-TAP CHIP BELONGS HERE: chat-phrases.test.ts holds every chip builder to this list.
 */

/** Pairs a string's two halves, named `tr` so scripts/gen-ui-strings.mjs harvests the English (src/lib/openers.ts). */
const tr = (en: string, vi: string): Bilingual => ({ en, vi })

/**
 * The one-tap sentences that are not built by a pure function this module can call: the seller's chips in
 * src/components/marketplace/quick-reply-chips.tsx (a client component) and the teacher-thread chips there. Only
 * COMPLETE chips — a chip that fills the composer ("Can meet in ") is finished by a person, in their own words.
 */
const CHIP_TEXTS: readonly Bilingual[] = [
  tr('Yes, still available', 'Vẫn còn hàng nhé'),
  tr('Price is firm', 'Giá cố định ạ'),
  tr('Let me think about it', 'Để mình cân nhắc nhé'),
  tr('Yes, still hiring', 'Vẫn đang tuyển nhé'),
  tr('Please send your CV', 'Bạn gửi CV giúp mình nhé'),
  tr('Thank you for reaching out — I am interested. Could you tell me more about the role?', 'Cảm ơn bạn đã liên hệ — mình rất quan tâm. Bạn có thể cho mình biết thêm về vị trí này không?'),
  tr('Thank you for thinking of me — I am not available at the moment.', 'Cảm ơn bạn đã nghĩ đến mình — hiện tại mình chưa thể nhận thêm.'),
  tr('Two questions: when could you start, and what teaching schedule are you looking for?', 'Cho mình hỏi bạn có thể bắt đầu từ khi nào và mong muốn lịch dạy như thế nào ạ?'),
]

const both = (f: (tr: (en: string, vi: string) => string) => string): Bilingual => ({ en: f((en) => en), vi: f((_en, vi) => vi) })

/** Every one-tap pair, keyed by each half as sent. */
export const ONE_TAP_PHRASES: readonly Bilingual[] = [
  both((t) => quickChatOpener(null, t)),
  both((t) => teacherOpener(t, 'hire', 'person')),
  both((t) => teacherOpener(t, 'hire', 'school')),
  both((t) => teacherOpener(t, 'cover', 'school')),
  { en: JOB_DM_KEEP_TEXTS.en, vi: JOB_DM_KEEP_TEXTS.vi },
  { en: JOB_DM_STOP_TEXTS.en, vi: JOB_DM_STOP_TEXTS.vi },
  ...OPENER_TEXTS,
  ...CHIP_TEXTS,
]
export { SYSTEM_LINES, halvesOf, localizeLineHead, localizeSystemLine } from './chat-lines'

const ONE_TAP = new Map<string, Bilingual>()
for (const p of ONE_TAP_PHRASES) { ONE_TAP.set(p.en, p); ONE_TAP.set(p.vi, p) }

/**
 * The reader's own words for a line eno wrote, or null when `text` holds anyone else's words, or the reader reads one of
 * the machine-translated languages (then it is shown, and translated, exactly as before). `lang` is the reader's UI
 * language.
 */
export function localizeChatText(text: string, lang: string): string | null {
  const line = localizeSystemLine(text, lang)
  if (line !== null || !TWO_LANGS.has(lang)) return line
  const p = ONE_TAP.get(text.trim())
  return p ? half(p, lang) : null
}

/** A line eno wrote, for a reader of `lang`: shown in their half, never sent to machine translation. */
export const isFixedChatText = (text: string, lang: string): boolean => localizeChatText(text, lang) !== null
