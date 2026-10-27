/**
 * The vendor cost of a session — an ESTIMATE in millionths of a US dollar, logged on the row (never billed) so the admin
 * page can compare the pilot's spend with its cap and with each vendor's console. List prices checked 2026-10-27, each
 * with its source, in ~/eno-classroom-2026-10-25/cost/research-2026-10-27.json; re-check before trusting a total.
 * Measured against a real session (2026-10-27, 175 s, 11 turns): ≈ $0.06 with the Soniox voice.
 */
export const PRICE = {
  /** Spatius: billed per CONNECTED 6-second credit, idle included — $0.009 a minute (Builder's additional usage). */
  spatiusPerCredit: 900,
  /** Soniox live listening: the whole OPEN stream (~$0.06 an hour, silence included), plus ~$0.06 per hour of speech. */
  sonioxStreamPerHour: 60_000,
  sonioxSpeechPerHour: 60_000,
  /** Soniox's voice: ~$0.70 per hour of speech made, plus its text in (~0.3 tokens a character at $4 a million). */
  sonioxVoicePerHour: 700_000,
  sonioxVoicePerChar: 1.2,
  /** The avatar speaks ~15 characters a second (600 characters ≈ 40 s). */
  voiceCharsPerSecond: 15,
  /** Azure Pronunciation Assessment with prosody: ~$1.30 per audio hour — repeat-after-me drills only (azure-speech.ts). */
  assessPerHour: 1_300_000,
  /** One tutor turn: OpenAI gpt-6-luna, priority tier (~2,600 tokens in, a third of it cached; ~120 out). */
  tutorPerCall: 560,
  /** The brain warmed at each start (tutor-ai.ts warmTutorBrain: ~1,050 tokens in, ~40 out). */
  warmUpPerSession: 250,
  /** One report: Gemini 3.8 Flash on Vertex (~5k tokens in, ~1.5k out with its thinking; introductory price to 2026-12-31). */
  reportPerCall: 9_000,
} as const

/**
 * `assessedMs`: the learner audio sent to Azure to be scored (drill turns, a failed call included — it may be billed);
 * `aiCalls`: the tutor's model calls; `reportCalls`: the report's. The voice is priced at Soniox's rate even when the box
 * spoke a line (session-voice.ts) — the box costs nothing per line, so the estimate errs high.
 */
export function estimateCostMicroUsd(s: {
  mode: string; usedSeconds: number; assessedMs: number; aiCalls: number; reportCalls: number; learnerSpeechMs: number; avatarChars: number
}): number {
  const face = s.mode === 'avatar' ? Math.ceil(s.usedSeconds / 6) * PRICE.spatiusPerCredit : 0
  const listening = (s.usedSeconds / 3600) * PRICE.sonioxStreamPerHour + (s.learnerSpeechMs / 3_600_000) * PRICE.sonioxSpeechPerHour
  const voice = (s.avatarChars / PRICE.voiceCharsPerSecond / 3600) * PRICE.sonioxVoicePerHour + s.avatarChars * PRICE.sonioxVoicePerChar
  const assess = (s.assessedMs / 3_600_000) * PRICE.assessPerHour
  const brain = s.aiCalls * PRICE.tutorPerCall + PRICE.warmUpPerSession + s.reportCalls * PRICE.reportPerCall
  return Math.round(face + listening + voice + assess + brain)
}
