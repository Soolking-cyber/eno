/**
 * The vendor cost of a session — an ESTIMATE in millionths of a US dollar, logged on the row (never billed) so the admin
 * page can compare the pilot's spend with its cap and with Spatius's own console (plan: "Each week, admin compares it
 * with Spatius's console minutes"). List prices as researched on 2026-10-25/26; re-check before trusting a total.
 * ⚠️ The transcript and the voice cost nothing per minute since 2026-10-26: eno's own speech server on the box
 * (speech-local.ts) — the box is paid for either way. What is left is the face, the drills' scores and the model.
 */
export const PRICE = {
  /** Spatius: billed per CONNECTED minute, idle included — Builder overage ~$0.009–0.01/min. */
  spatiusPerMinute: 10_000,
  /** Azure Pronunciation Assessment: ~$1 per audio hour — repeat-after-me drills only (azure-speech.ts). */
  assessPerHour: 1_000_000,
  /** One Gemini 3.8 Flash call of this size (a few thousand tokens in, a short JSON out) — a rough upper bound. */
  geminiPerCall: 600,
} as const

/** `assessedMs`: the learner audio sent to Azure to be scored (drill turns, a failed call included — it may be billed). */
export function estimateCostMicroUsd(s: { mode: string; usedSeconds: number; assessedMs: number; aiCalls: number }): number {
  const spatius = s.mode === 'avatar' ? Math.ceil(s.usedSeconds / 60) * PRICE.spatiusPerMinute : 0
  const assess = Math.round((s.assessedMs / 3_600_000) * PRICE.assessPerHour)
  return spatius + assess + s.aiCalls * PRICE.geminiPerCall
}
