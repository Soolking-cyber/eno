/**
 * "Report" on an answer eno's AI gave: the text assistant (/messages/ai) and the voice guide's caption. Google Play's
 * AI-Generated Content policy asks for it in the apps (a person flags offensive AI output without leaving the app). The
 * web gets the same control, as with every Report: the `ugc-safety` gate decides both.
 *
 * Filed as Feedback of kind 'ai' (POST /api/feedback → Admin › Feedback), never as a Report. A Report names a person, a
 * listing or a thread to act against (api/report), and an AI answer has no author: nobody's trust score moves. The
 * answer itself travels in the message, so the team reads what the person saw. Nothing new is collected: the fields the
 * Help sheet's feedback sends (a message, the page), for "your questions, reports and support requests" (/privacy).
 *
 * ⚠️ IT REPORTS WHAT WAS ON SCREEN, AS A SNAPSHOT, AND NEVER CLAIMS WHO WROTE IT (commit review, rounds 1–2: marking which
 * lines the AI wrote, and tracking a guide reply as it grew, each produced a new hole per round). A saved chat cannot
 * tell an answer from eno's own line in its place (a limit, an error), nor a keyword answer from Google's; the team can.
 */
export type AiReportSurface = 'assistant' | 'voice-guide'
export type AiReportReason = 'offensive' | 'wrong' | 'other'

export const AI_REPORT_REASONS: readonly { value: AiReportReason; en: string; vi: string }[] = [
  { value: 'offensive', en: 'Offensive or harmful', vi: 'Phản cảm hoặc có hại' },
  { value: 'wrong', en: 'Wrong or misleading', vi: 'Sai hoặc gây hiểu lầm' },
  { value: 'other', en: 'Something else', vi: 'Lý do khác' },
]

/** The feedback route keeps 4,000 characters (api/feedback): the note and the answer are capped so it never cuts the answer.
 *  2,500 is above every answer today: the chat's reply is cut at 500 characters (api/ai/concierge), the guide's turn at
 *  400 output tokens (concierge/brain.ts MAX_OUTPUT_TOKENS). */
export const AI_REPORT_NOTE_MAX = 1000
export const AI_REPORT_ANSWER_MAX = 2500

export type AiReport = { surface: AiReportSurface; reason?: AiReportReason; note?: string; answer: string }

/** What Admin › Feedback shows (admin chrome is English). The voice guide's one-tap flag gives no reason. */
export function aiReportMessage(r: AiReport): string {
  const where = r.surface === 'voice-guide' ? 'the voice guide' : 'eno AI chat'
  const note = (r.note ?? '').trim().slice(0, AI_REPORT_NOTE_MAX)
  return [
    `Reported in ${where}${r.reason ? `: ${r.reason}` : ''}`,
    note,
    `The answer:\n${r.answer.trim().slice(0, AI_REPORT_ANSWER_MAX)}`,
  ].filter(Boolean).join('\n\n')
}

/** A report still on its way after this gives up (false), so a control waiting on it is never stuck (codex, round 5). */
export const AI_REPORT_TIMEOUT_MS = 10_000

/** Files it; true once the server has it. Never throws. `url`: the page the person was on, as the Help sheet sends it. */
export async function sendAiReport(r: AiReport & { url: string }): Promise<boolean> {
  const giveUp = new AbortController()
  const timer = setTimeout(() => giveUp.abort(), AI_REPORT_TIMEOUT_MS)
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ai', message: aiReportMessage(r), url: r.url }),
      signal: giveUp.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
