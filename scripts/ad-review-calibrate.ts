#!/usr/bin/env -S npx tsx
// ── Calibrate the ad review's Jev thresholds (src/lib/ads/review-jev.ts) on the hand-made samples ──────────────────────
//
//   TYPESAFE_API_KEY=… npx tsx scripts/ad-review-calibrate.ts            # one call a sample (36), ≈ 700 input tokens each
//
// READ-ONLY: it calls Jev with the review's own questions and state builder, prints each class's scores for the samples
// labelled with it (they must clear the threshold) and the highest score any LAWFUL sample got (it must stay below), and
// exits 1 when a pinned threshold does not separate them. Re-pin JEV_AD_THRESHOLDS (with JEV_AD_MODEL) from its output,
// then set JEV_AD_CALIBRATION. ⚠️ It measures Jev only: Gemini's picture threshold (AD_MODERATION_THRESHOLD) is not.
// Nothing is written anywhere.
import { AD_QUESTION_KEYS, AD_QUESTIONS, JEV_AD_MODEL, JEV_AD_THRESHOLDS, jevAdQuestions, jevAdState, readJevAnswers, type AdQuestionKey } from '../src/lib/ads/review-jev'
import { REVIEW_SAMPLES } from '../src/lib/ads/creative-review.fixture'

const key = process.env.TYPESAFE_API_KEY?.trim()
if (!key) {
  console.error('TYPESAFE_API_KEY is required')
  process.exit(1)
}

const scores = new Map<string, Record<AdQuestionKey, number>>()
for (const s of REVIEW_SAMPLES) {
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: JEV_AD_MODEL, state: jevAdState(s.words), questions: jevAdQuestions() }),
  })
  if (!res.ok) throw new Error(`${s.id}: HTTP ${res.status}`)
  const answers = readJevAnswers(((await res.json()) as { answers?: unknown }).answers)
  if (!answers) throw new Error(`${s.id}: an answer is missing or malformed`)
  scores.set(s.id, answers)
}

// What calibration must show (commit gate, opus): every unlawful sample is refused by the class it is labelled with
// (recall), and NO lawful sample reaches any refusing class (precision where it matters: a lawful ad must pass). An unlawful
// sample scoring high on a second refusing class is still refused, so that is never a failure. Permit classes only record.
const lawful = REVIEW_SAMPLES.filter((s) => s.expect === 'approve')
let bad = 0
for (const k of AD_QUESTION_KEYS) {
  const family = AD_QUESTIONS[k].family
  const threshold = family === 'permit' ? JEV_AD_THRESHOLDS.permit : family === 'banned' ? JEV_AD_THRESHOLDS.banned : JEV_AD_THRESHOLDS.claim
  const labelled = REVIEW_SAMPLES.filter((s) => s.classes.includes(k)).map((s) => [s.id, scores.get(s.id)![k]] as const)
  const lowest = labelled.length ? Math.min(...labelled.map(([, p]) => p)) : null
  const [topId, top] = lawful.filter((s) => !s.classes.includes(k)).map((s) => [s.id, scores.get(s.id)![k]] as const)
    .reduce((m, o) => (o[1] > m[1] ? o : m), ['—', 0] as readonly [string, number])
  // ⛔ A refusing class with NO labelled sample is NOT MEASURED, never a pass: its recall is unknown.
  const ok = family === 'permit' ? true : lowest !== null && lowest >= threshold && top < threshold
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${k.padEnd(22)} ${family.padEnd(6)} ≥${threshold}  labelled: ${labelled.map(([id, p]) => `${id} ${p.toFixed(2)}`).join(', ') || 'NONE (not measured)'}  ·  highest lawful: ${topId} ${top.toFixed(2)}`)
}
console.log(bad ? `\n${bad} class(es) not separated at the pinned thresholds — re-pin JEV_AD_THRESHOLDS (${JEV_AD_MODEL}).` : `\nEvery class separated at the pinned thresholds (${JEV_AD_MODEL}).`)
process.exitCode = bad ? 1 : 0
