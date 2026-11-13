/**
 * The Gemini model ids, in a PURE module.
 *
 * ⛔ WHY THESE ARE NOT IN gemini.ts. That module opens with `import 'server-only'`, which cannot be
 * resolved outside Next's bundler — `server-only` has no top-level install here, and outside the
 * `react-server` condition its entry point throws by design. So a maintenance script that wants to
 * call the same model the app calls cannot import the constant, and the only alternative is to
 * hardcode a second copy of the string. That copy is exactly what goes stale: the app moved
 * 3.5 → 3.6 → 3.7 → 3.8 → 4 Hydrogen this year, and a script pinned to the old line would keep working while
 * quietly running a different model than every user-facing path.
 *
 * gemini.ts re-exports both names, so every existing `from '@/lib/gemini'` import is unchanged.
 */
import { ThinkingLevel, type ThinkingConfig } from '@google/genai'

// ALL AI paths run this one model (image classify, description polish, concierge, visual-search,
// brands, admin review).
// Gemini 4 Hydrogen since 2026-11-13 (owner: "all places where they use 3.8 flash change t new 4 hydriogen", "all
// across the app"), the day after Google released it; it replaced gemini-3.8-flash.
// ⛔ HARD REQUIREMENT: the 3.x flash line AND 4 Hydrogen are served from the GLOBAL Vertex endpoint ONLY — they 404
// on regional endpoints (Hydrogen measured 2026-11-13 on asia-southeast1 and us-central1), which broke post-wizard AI
// on 2026-07-06 when GEMINI_LOCATION was us-central1. GEMINI_LOCATION MUST be `global`.
export const GEMINI_MODEL = 'gemini-4-hydrogen'

// The fallback when 4 Hydrogen fails: Gemini 3.8 Flash since 2026-11-13 (owner: "fallback 3.8 flash now"), the model the
// whole app ran on until that day. Used by admin review, the itinerary and visa-extract routes, and (as
// IMPORT_MODEL_FALLBACK) the teacher and classroom paths.
// ⚠️ DELIBERATELY NOT ALSO HYDROGEN — a fallback identical to the primary is not a fallback.
// ⚠️ GLOBAL-ONLY, LIKE THE PRIMARY: the fallback before it (gemini-2.5-flash) also answered on regional endpoints, so it
// survived an incident on Vertex's `global` endpoint; this one does not. Both take a thinking LEVEL (quickThinking).
export const GEMINI_MODEL_FALLBACK = 'gemini-3.8-flash'

/** Gemini 3.5 Flash-Lite — NOT a fallback any more: the teacher photo check's fast first seat and the second judge of a
 * classroom background (photo-check.ts, backgrounds-upload.ts). */
export const FLASH_LITE_MODEL = 'gemini-3.5-flash-lite'

/**
 * ⛔ 4 HYDROGEN REFUSES `thinkingBudget`: Vertex answers 400 "Thinking budget is not supported for this model. Use
 * thinking level instead" (measured 2026-11-13; 3.8 Flash still took `thinkingBudget: 0`). Both refuse the MINIMAL
 * level. A 2.x model is the other way round: it takes the budget and refuses a level. So "think as little as you can"
 * depends on the model, and a quick call asks quickThinking() for it instead of spelling one out.
 */
export const takesThinkingLevel = (model: string): boolean => !/^gemini-[12]\./.test(model)

/**
 * ⚠️ LOW STILL THINKS ON 4 HYDROGEN: ~80–190 thinking tokens on a one-line task, measured 2026-11-13 (3.8 Flash at LOW
 * thought 0). Thinking tokens count against maxOutputTokens: capped at 128, a one-word JSON answer came back
 * MAX_TOKENS and empty. So a call sized for its answer alone gets THINKING_ROOM more. Room is a ceiling, not a charge.
 */
export const THINKING_ROOM = 1_024

/** The least thinking `model` allows, with room for it beside an answer of up to `answerTokens`. */
export function quickThinking(model: string, answerTokens: number): { thinkingConfig: ThinkingConfig; maxOutputTokens: number } {
  return takesThinkingLevel(model)
    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: answerTokens + THINKING_ROOM }
    : { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: answerTokens }
}
