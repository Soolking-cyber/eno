/**
 * The vendor cost of a session — an ESTIMATE in millionths of a US dollar, logged on the row (never billed) so the admin
 * page can compare the pilot's spend with its cap and with Spatius's own console (plan: "Each week, admin compares it
 * with Spatius's console minutes"). List prices as researched on 2026-10-25; re-check before trusting a total.
 */
export const PRICE = {
  /** Spatius: billed per CONNECTED minute, idle included — Builder overage ~$0.009–0.01/min. */
  spatiusPerMinute: 10_000,
  /** Azure speech-to-text, standard: ~$1 per audio hour — paid twice per turn (transcript, then the scored pass). */
  speechPerHour: 1_000_000,
  /** Azure neural TTS: ~$16 per million characters. */
  ttsPerChar: 16,
  /** One Gemini 3.8 Flash call of this size (a few thousand tokens in, a short JSON out) — a rough upper bound. */
  geminiPerCall: 600,
} as const

export function estimateCostMicroUsd(s: { mode: string; usedSeconds: number; learnerSpeechMs: number; avatarChars: number; aiCalls: number }): number {
  const spatius = s.mode === 'avatar' ? Math.ceil(s.usedSeconds / 60) * PRICE.spatiusPerMinute : 0
  const speech = Math.round((s.learnerSpeechMs / 3_600_000) * PRICE.speechPerHour * 2)
  const tts = s.avatarChars * PRICE.ttsPerChar
  return spatius + speech + tts + s.aiCalls * PRICE.geminiPerCall
}
