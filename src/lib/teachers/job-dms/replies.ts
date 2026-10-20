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
/** The teacher asking to go on: the "Keep sending jobs" chip, or the same words typed. Lifts a PAUSE (run.ts). */
export function isKeepReply(text: string | null | undefined): boolean {
  if (!text) return false
  const t = fold(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t === fold(JOB_DM_KEEP_TEXTS.en) || t === fold(JOB_DM_KEEP_TEXTS.vi)
    || /^(please |yes |ok |okay )?(keep|continue|carry on|resume) (sending|send)( (me|us))?( (jobs?|job messages?|them|these|please|pls|thanks|thank you))*$/.test(t)
    || /^(vui long |xin |cu )?gui tiep( (viec lam|cho (toi|minh|em)|nhe|nha|a|giup|giup minh))*$/.test(t)
}

export function isStopReply(text: string | null | undefined): boolean {
  if (!text) return false
  const t = fold(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return false
  // A long message withdraws only when it OPENS with the word ("STOP. I found work and never agreed to this" — codex, gate
  // 3g). Anything else long that may be an opt-out PAUSES the sending instead (mayBeOptOut, run.ts) until a person on the
  // team has read it: five review rounds (gates 2d–3g) showed every phrase list both misses real opt-outs and catches job
  // talk, so free text never flips the switch on its own — it stops the machine and asks a human.
  // The opening word must STAND ALONE — "STOP." / "Stop!" / "Dừng lại." — "Stop by the school tomorrow?" and "Hủy buổi
  // phỏng vấn job 2" (cancel my interview) are not (opus, gate 3h); they go to the pause reader.
  if (t.length > 60) {
    // An opening STOP in CAPITALS is the keyword however it goes on ("STOP I already found work" — codex, gate 3j); in
    // lower case it must stand as its own sentence — "Stop - I meant job 3 …" is not one (opus, gate 3j).
    // (…unless it plainly goes somewhere else: "STOP by the school tomorrow?", a question — codex, gate 3l)
    if (/^\s*(STOP|UNSUBSCRIBE)\b(?!\s+(by|at|over|in)\b)/.test(text) && !/^[^.!\n]*\?/.test(text)) return true
    const typed = text.normalize('NFC').toLowerCase().trim()
    // A sentence's end only — "Stop, I meant job 3 …" and "Ngừng lại, cho em hỏi …" are not (opus, gate 3m).
    return /^(stop|unsubscribe)( (please|pls|now|it|this|these|them|thanks|thank you))*\s*([.!]|$)/.test(typed)
      // …with a particle ("Dừng lại nhé," — a request) a comma ends it too; bare ("Ngừng lại, cho em hỏi …") it does not
      || /^(dừng lại|ngừng lại|hủy đăng ký|huỷ đăng ký|dừng|ngừng)( (nhé|nha|ạ|đi|giúp|giùm|giúp mình))+\s*([.!,]|$)/u.test(typed)
      || /^(dừng lại|ngừng lại|hủy đăng ký|huỷ đăng ký|dừng|ngừng)\s*([.!]|$)/u.test(typed)
  }
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
  // "không nhận" alone declines ONE cover (opus, gate 2d): a stop needs "nữa" / "thêm" (any more) or "tin nhắn" (messages).
  if (/^(xin |vui long )?(khong|ko|k) (nhan|muon nhan)( (tin|viec|viec lam))?( (tin nhan|nua|them))( (nua|them|a|nhe|nha|cam on|tin nhan))*$/.test(t)) return true
  // "đừng gửi nữa" only typed with its marks — folded, "dung gui" is also "Dũng gửi …"
  return /^(xin )?đừng (gửi|nhắn)( (nữa|tin|tin nhắn|việc|việc làm|nhé|nha|ạ|cho mình|cho tôi|cho em))*$/u.test(text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim())
}

const VI_WORD = '(?<![\\p{L}\\p{N}])' // JS's \\b is ASCII-only, even under /u: "\\bđừng" never matches (opus, gate 3e)

/**
 * A reply that MAY ask the desk to stop — broad on purpose, because a miss here is the costly error and a false hit costs
 * only a pause: run.ts sends that teacher nothing more until someone on the team has answered in the thread (a person
 * reads every reply anyway — /privacy). Never a withdrawal by itself: that is isStopReply, which is narrow.
 */
export function mayBeOptOut(text: string | null | undefined): boolean {
  if (!text) return false
  if (isStopReply(text)) return true
  const t = fold(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > 0 && longOptOut(t, text)
}

function longOptOut(t: string, raw: string): boolean {
  // ⚠️ No "keep sending" override: "Why do you KEEP MESSAGING me? … stop it" and "do not CONTINUE SENDING" are the
  // angriest opt-outs (opus, gate 3f). A wish to go on only answers the weak "not interested" below.
  const goOn = /\b(keep|continue|please do) (sending|send)\b/.test(t) && !/\b(do not|don t|dont|never|why do you|why are you|stop) (keep|continue)/.test(t)
  const notAboutUs = t
    .replace(/\bbus stop\b|\bstop by\b|\bstop (teaching|working|doing)\b|\b(never|didn t|did not|doesn t|does not|don t|do not) (text|message|reply|answer|call|write|email)s? (me )?back\b/g, ' ')
    // what the TEACHER sends or is sent about one job: "I'll stop sending CVs", "don't send me the address", "no more
    // messages from the school", "remove me from the shortlist", "I opt out of nights" (gates 3b–3d)
    .replace(/\bstop (sending|applying|messaging|contacting|emailing) (cvs?|resumes?|applications?|my|to (schools?|centres?|centers?|them|employers?))\b/g, ' ')
    .replace(/\b(do not|don t|dont) (send|message|text|email) me (the|your|an?|that|this|my) (address|link|cv|details|location|map|number|phone|email|info|form|contract|schedule)\b/g, ' ')
    .replace(/\bno more (\w+ )?(messages|texts|replies|news) from\b/g, ' ')
    .replace(/\bremove me from (the|this|that|your) (shortlist|interview|application|class|schedule|roster|timetable|group chat)\b/g, ' ')
    .replace(/\bopt (me )?out of (nights?|weekends?|mornings?|evenings?|afternoons?|the (night|weekend|morning|evening|afternoon))\b/g, ' ')
  if (/\bstop\b[^.!?]{0,40}\b(message|messages|messaging|texting|sending|send|jobs?|job (messages|alerts|offers)|alerts?|offers?|these|this|them|it|contacting|emails?|notifications?)\b/.test(notAboutUs)) return true
  if (/\b(unsubscribe|opt (me )?out|remove me|delete me|take me off|leave me alone|no longer interested|(revoke|withdraw) (my )?consent|do not consent|don t consent)\b/.test(notAboutUs)) return true
  // "not interested" is about ONE job as often as about these messages ("not interested in job 1, but job 2 …" — codex +
  // opus, gate 3f): it counts only about the messages, or with nothing asked for after it.
  if (!goOn && /\bnot interested (in (these|this|your|the) (messages|jobs|job messages|offers)|any ?more|at all|thanks|thank you)\b/.test(notAboutUs)) return true
  if (/\bno more (job |of )?(these |this |your )?(messages|jobs|alerts|offers|texts)\b/.test(notAboutUs)) return true
  if (/\b(don t|do not|dont) (want|wish|need) (to (receive|get) )?(these|this|your|any|the|job)( job)? (messages|jobs|alerts|offers|texts)\b/.test(notAboutUs)) return true
  // "… do not want any further contact from your service" (codex, gate 3m)
  if (/\b(no|any) (further|more) (contact|messages|texts)\b|\b(don t|do not|dont) (want|wish) (to be )?contact(ed)?\b/.test(notAboutUs)) return true
  if (/\b(do not|don t|dont|never) ((continue|keep) )?(send|message|text|contact|email|spam)(ing)? (me|us)\b/.test(notAboutUs)) return true
  // Vietnamese, typed with its marks (unambiguous) …
  const typed = raw.normalize('NFC').toLowerCase()
  // ("thôi gửi CV cho trường đó" is the teacher's own sending — opus, gate 3f — so "thôi" counts only with "tin" / "cho tôi")
  if (new RegExp(`${VI_WORD}(đừng|ngừng|dừng) (gửi|nhắn)|${VI_WORD}thôi (gửi|nhắn) (tin|cho (tôi|mình|em))|${VI_WORD}không (muốn )?nhận (thêm |tin nhắn |tin |việc làm |việc )?nữa|${VI_WORD}(hủy|huỷ) đăng ký|${VI_WORD}không (muốn|cần) nhận (tin nhắn|tin|việc)`, 'u').test(typed)) return true
  // … or folded, where the words are not also names or "đúng" ("dung gui" is also "Dũng gửi"; "ko nhan tin lai" is
  // "did not text back")
  return /\b(ngung (gui|nhan)|huy dang ky|khong muon nhan|(khong|ko) nhan (tin nhan |tin |viec lam )?nua)\b/.test(t)
}
