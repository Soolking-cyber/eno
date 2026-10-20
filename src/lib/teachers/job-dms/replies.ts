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
    // No special case for capitals: every guess at what follows a shouted STOP was wrong one way or the other (gates
    // 3j–4a). A long message that does not open with STOP as its own sentence goes to the PAUSE, which stops sending
    // just the same and tells the teacher how to stop for good.
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

/** The messages, by name or "them/these/those" — never a bare "it/this" in a long reply (a phone, a projector). */
const MSGS = '(them|these|those|(the |these |those |my |your |all |all the |all these |all those |all your |all my |all of the |all of these |all of those |all of your |all of my |eno |eno s )?(job |eno )?(messages|alerts|offers|notifications|texts|emails|dms|updates))'
const NOT_A_SUBJECT = '(?<!\\b(you|u|they|it|eno|why|who|which|that) )'
const DONT = '(please )?((don t|do not|dont)( ever| you dare)?|never( ever)?)'
/**
 * Asking to KEEP them (opus, gates 6a–7c): "please DON'T (ever) stop the job alerts", "don't you dare stop them", "never
 * stop the job alerts!", "don't turn off / switch off job alerts" — every shape the turn-off rule reads (MSGS) —, "why
 * did you stop the job messages?", "I hope you won't stop them". Only those: "WILL you stop messaging me?", "you won't
 * stop, will you", "why don't you stop sending me these", "don't you ever stop sending me these?", "you don't stop
 * sending me jobs" and "DID you stop sending me these like I asked?" (opus, gate 6e) are the opposite — a question about
 * stopping can be either, and a wrong pause is the cheap error.
 */
// ⚠️ 'g' — used ONLY with String.replace (which resets lastIndex); a .test() on it would be stateful.
const KEEP_ASKS = new RegExp([
  `${NOT_A_SUBJECT}\\b${DONT} stop (the|these|sending|your|them)\\b`,
  `${NOT_A_SUBJECT}\\b${DONT} (turn|switch|shut) (off (${MSGS}|it|this)|(${MSGS}|it|this) off)\\b`,
  '\\bwhy (did|would|have) you (stop|stopped)\\b',
  '\\b(hope|wish) (that )?(you |eno )?(won t|will not|don t|do not|never) (ever )?stop\\b',
].join('|'), 'g')
/** "Please keep them stopped", "leave the job alerts off" (codex, gate 6h). */
const KEEP_THEM_OFF = new RegExp(`\\b(keep|leave) ${MSGS}( switched| turned)? (stopped|off)\\b`)
/** "Turn off the job alerts", "switch those off", "how do I turn off my job alerts?" (codex + opus, gates 6h–7a2). */
const TURN_THEM_OFF = new RegExp(`\\b(turn|switch|shut) (${MSGS} off|off ${MSGS})\\b`)
/** A SHORT reply that is just "turn this off" / "turn it off" (opus, gate 7a2) — in a long one, "it" can be anything. */
const TURN_IT_OFF = /\b(turn|switch|shut) (it|this) off\b|\b(turn|switch|shut) off (it|this)\b/

function longOptOut(t: string, raw: string): boolean {
  // ⚠️ No "keep sending" override: "Why do you KEEP MESSAGING me? … stop it" and "do not CONTINUE SENDING" are the
  // angriest opt-outs (opus, gate 3f). A wish to go on only answers the weak "not interested" below.
  const goOn = /\b(keep|continue|please do) (sending|send)\b/.test(t) && !/\b(do not|don t|dont|never|why do you|why are you|stop) (keep|continue)/.test(t)
  // A threat or a complaint about THESE messages — aimed at us, whole words: "I'll report back", "blocks of lessons" and
  // "Suez" are not (opus, gate 6c), and nor is "they aren't spam" (codex, gate 6c) — but "I just love spam" is.
  const threatened = /\b(report|block|sue)(ed|ing)? (you|this|these|it|eno|your)\b|\b(police|lawyer|harass\w*)\b|(?<!\b(aren t|are not|isn t|is not|not|never|no|any) )\b(complain\w*|spam(my|ming|med)?)\b/.test(t)
  const notAboutUs = t
    // Asking to KEEP them is taken out (KEEP_ASKS) — unless the reply threatens or complains, which leaves every "stop"
    // where it is ("if you don't stop the job messages I'll report you" — codex + opus, gate 6b).
    .replace(threatened ? /$^/ : KEEP_ASKS, ' ')
    .replace(/\bbus stop\b|\bstop by\b|\bstop (teaching|working|doing)\b|\b(never|didn t|did not|doesn t|does not|don t|do not) (text|message|reply|answer|call|write|email)s? (me )?back\b/g, ' ')
    // what the TEACHER sends or is sent about one job: "I'll stop sending CVs", "don't send me the address", "no more
    // messages from the school", "remove me from the shortlist", "I opt out of nights" (gates 3b–3d)
    .replace(/\bstop (sending|applying|messaging|contacting|emailing) (cvs?|resumes?|applications?|my|to (schools?|centres?|centers?|them|employers?))\b/g, ' ')
    .replace(/\b(stop|do not|don t|dont) (sending|send|messaging|message|texting|text|emailing|email) me (the|your|an?|that|this|my) (address|link|cv|details|location|map|number|phone|email|info|form|contract|schedule)\b/g, ' ')
    .replace(/\bno more (\w+ )?(messages|texts|replies|news) from\b/g, ' ')
    .replace(/\bremove me from (the|this|that|your) (shortlist|interview|application|class|schedule|roster|timetable|group chat)\b/g, ' ')
    .replace(/\bopt (me )?out of (nights?|weekends?|mornings?|evenings?|afternoons?|the (night|weekend|morning|evening|afternoon))\b/g, ' ')
  // Strong: "stop sending/messaging me" (the address-like objects were taken out above).
  if (/\bstop (sending|messaging|texting|contacting|emailing) ((me|us)\b|(these|this|the|your|any|all)( job)? (messages|alerts|offers|jobs|texts|emails)\b)/.test(notAboutUs)) return true
  // "Please stop the job messages, I'll apply to job 3 myself" — explicit stop words win over any talk of a job (opus, 5d),
  // asked as a question too ("Can you stop the job messages?"); the keep-shapes were taken out above.
  if (/\bstop (the|these|this|your|all|any)( job)? (messages|alerts|offers|texts|emails|notifications)\b/.test(notAboutUs)) return true
  // "Did you stop / have you stopped sending me these (like I asked)?" — a question about stopping can be either, so it
  // pauses (opus, gate 6e); "WHY did you stop …?" was taken out above as a wish to keep them.
  if (/\b(did|have|has) (you|eno) (stop|stopped) (sending|messaging|texting|contacting|emailing|the|these|this|your|all|any)\b/.test(notAboutUs)) return true
  // The same wish in other verbs: "please keep them stopped", "leave the job alerts off", "turn off the job alerts",
  // "switch these off", "how do I turn off the job alerts?" (codex + opus, gates 6h–7b) — the messages by name or
  // "them/these", never a bare "it/this" (a phone, a projector). ⚠️ No first-person exclusion: "I want to turn off these
  // messages" is the plainest opt-out, so a teacher DESCRIBING their phone ("I turn off notifications in class") is
  // paused too — the cheap error (PAUSE_ACK offers Keep); "don't turn off …" was taken out above as a wish to keep them.
  if (KEEP_THEM_OFF.test(notAboutUs) || TURN_THEM_OFF.test(notAboutUs)) return true
  if (t.length <= 40 && TURN_IT_OFF.test(notAboutUs)) return true
  // Weak — "stop" near a word about messages — unless the reply is plainly about a job ("Stop - I meant job 3, please
  // send me the details" — opus, gate 4b).
  // ⚠️ "about a job" = a numbered job AND a request about it — never a bare "applied" or "interview" ("Please stop the job
  // messages, I got hired after an interview" is an opt-out — opus, gate 4c).
  const aboutAJobEarly = /\bjob \d+\b/.test(t) && /\b(send|details|address|link|info|location|meant|still (open|available)|apply|applying)\b/.test(t)
  if (!aboutAJobEarly && /\bstop\b[^.!?]{0,40}\b(message|messages|messaging|texting|sending|send|jobs?|job (messages|alerts|offers)|alerts?|offers?|these|this|them|it|contacting|emails?|notifications?)\b/.test(notAboutUs)) return true
  if (/\b(unsubscribe|opt (me )?out|remove me|delete me|take me off|leave me alone|no longer interested|(revoke|withdraw) (my )?consent|do not consent|don t consent)\b/.test(notAboutUs)) return true
  // "not interested" is about ONE job as often as about these messages ("not interested in job 1, but job 2 …" — codex +
  // opus, gate 3f): it counts only about the messages, or with nothing asked for after it.
  if (!goOn && /\bnot interested (in (these|this|your|the) (messages|jobs|job messages|offers)|any ?more|at all|thanks|thank you)\b/.test(notAboutUs)) return true
  if (/\bno more (job |of )?(these |this |your )?(messages|jobs|alerts|offers|texts)\b/.test(notAboutUs)) return true
  if (/\b(don t|do not|dont) (want|wish|need) (to (receive|get) )?(these|this|your|any|the|job)( job)? (messages|jobs|alerts|offers|texts)\b/.test(notAboutUs)) return true
  // A message that OPENS with stop / unsubscribe, and "I never consented / signed up" (gate 4a): at least a pause —
  // unless it is plainly about a job ("Stop - I meant job 3, send me the details", "I never asked for job 3's address" —
  // opus, gate 4b).
  const aboutAJob = aboutAJobEarly
  if (!aboutAJob && /^(stop|unsubscribe)\b/.test(t) && !/^stop (by|at)\b/.test(t)) return true
  if (!aboutAJob && /\b(never|did not|didn t|didnt) (consent|consented|agree|agreed|sign up|signed up|opt in|opted in|ask for|asked for)\b/.test(notAboutUs)) return true
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
