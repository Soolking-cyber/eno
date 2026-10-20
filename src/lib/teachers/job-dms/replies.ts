/**
 * The teacher's two quick replies in a jobs-desk thread, and the server's reading of a STOP. Pure — the chat chips and
 * the cron both import it, so the words a chip sends and the words the server honours can never drift apart.
 */
import { fold } from '@/lib/fold'

/** What the "Stop job messages" chip sends, per language — the server reads each as a withdrawal. */
export const JOB_DM_STOP_TEXTS = { en: 'Stop job messages', vi: 'Dừng tin nhắn việc làm' } as const
/** What the "Keep sending jobs" chip sends — any reply resets "two until you reply"; this one just says so. */
export const JOB_DM_KEEP_TEXTS = { en: 'Keep sending jobs', vi: 'Gửi tiếp việc làm' } as const

/**
 * A reply that asks the desk to stop: the chip's words, or a short message that is just STOP / unsubscribe / no more /
 * dừng lại / ngừng (with optional "please", punctuation, "job messages"). A sentence that merely CONTAINS "stop" ("the
 * bus stop near the school?") is not one — only the whole short message counts.
 * ⛔ FOLDED, "dừng" (stop) is "đúng" (right) and "Dũng", and "hủy" is "Huy": "Đúng ạ" ("yes, right") read as a STOP
 * (opus, gate 2a). So a "dung"/"huy" typed WITHOUT marks counts only in "dung lai / dung gui / dung tin nhan", "huy dang
 * ky"; with its marks ("dừng", "hủy") it is unambiguous and counts alone.
 */
export function isStopReply(text: string | null | undefined): boolean {
  if (!text) return false
  const t = fold(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 60) return false
  if (t === fold(JOB_DM_STOP_TEXTS.en) || t === fold(JOB_DM_STOP_TEXTS.vi)) return true
  // "dừng" / "hủy" WITH their marks are unambiguous — read on the text as typed, before folding.
  const typed = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim()
  if (/^(xin )?(dừng|hủy|huỷ)( (lại|gửi|nhé|nha|ạ|giúp|giúp mình|giùm|tin nhắn|việc làm|đăng ký|nhắn))*$/u.test(typed)) return true
  if (/^(please )?(stop|unsubscribe|no more|ngung( gui| nhan)?|dung (lai|gui|nhan|tin nhan)|huy dang ky)( (it|this|these|them|please|pls|thanks|thank you|messages?|job messages?|jobs?|tin nhan( viec lam)?|nhe|giup|giup minh|nha))*$/.test(t)) return true
  // The longer ways to ask (opus, gate 2b) — "please stop sending me jobs", "stop messaging me", "unsubscribe me", "don't
  // send me these", "không nhận nữa", "đừng gửi nữa" — but the WHOLE message, anchored: "Stop teaching kids, I prefer
  // adults", "Không nhận được link", "Dũng gửi CV ạ" are not stops (codex + opus, gate 2c). The chip is the sure path.
  if (/^(please |pls |kindly )?(stop|unsubscribe|opt out)( (sending|messaging|texting|contacting))?( (me|us))?( (jobs?|job messages?|these|this|them|messages?|now|please|pls|thanks|thank you|any more|anymore|again))*$/.test(t)) return true
  if (/^(please |pls )?(do not|don t|dont) (send|message|text|contact)( (me|us))?( (jobs?|job messages?|these|this|them|messages?|any more|anymore|again|please|thanks|thank you))*$/.test(t)) return true
  if (/^(xin |vui long )?(khong|ko|k) (nhan|muon nhan)( (tin|tin nhan|viec|viec lam|nua|them|a|nhe|nha|cam on))*$/.test(t)) return true
  // "đừng gửi nữa" only typed with its marks — folded, "dung gui" is also "Dũng gửi …"
  return /^(xin )?đừng (gửi|nhắn)( (nữa|tin|tin nhắn|việc|việc làm|nhé|nha|ạ|cho mình|cho tôi|cho em))*$/u.test(text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim())
}
