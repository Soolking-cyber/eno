/**
 * The Gemini model ids, in a PURE module.
 *
 * ⛔ WHY THESE ARE NOT IN gemini.ts. That module opens with `import 'server-only'`, which cannot be
 * resolved outside Next's bundler — `server-only` has no top-level install here, and outside the
 * `react-server` condition its entry point throws by design. So a maintenance script that wants to
 * call the same model the app calls cannot import the constant, and the only alternative is to
 * hardcode a second copy of the string. That copy is exactly what goes stale: the app moved
 * 3.5 → 3.6 → 3.7 → 3.8 this year, and a script pinned to the old line would keep working while
 * quietly running a different model than every user-facing path.
 *
 * gemini.ts re-exports both names, so every existing `from '@/lib/gemini'` import is unchanged.
 */

// ALL AI paths run this one model (image classify, description polish, concierge, visual-search,
// brands, admin review).
// ⛔ HARD REQUIREMENT: the 3.x flash line is served from the GLOBAL Vertex endpoint ONLY — it 404s
// on regional endpoints, which broke post-wizard AI on 2026-07-06 when GEMINI_LOCATION was
// us-central1. GEMINI_LOCATION MUST be `global`.
export const GEMINI_MODEL = 'gemini-3.8-flash'

// Region-robust (works on global AND regional endpoints) — used for high-stakes retries (admin
// review) and as the safe manual downgrade if 3.8 has an incident.
// ⚠️ DELIBERATELY NOT ALSO 3.8 — a fallback identical to the primary is not a fallback. It stays on
// the older, region-robust line precisely so it survives an incident that takes 3.8 out.
export const GEMINI_MODEL_FALLBACK = 'gemini-2.5-flash'
