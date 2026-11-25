import type { ReviewReasonCode } from './review-reasons'

/**
 * ── WHAT JEV IS ASKED ABOUT AN AD (owner 2026-11-25; src/lib/listing-guard.ts is the listing twin). Pure, so the
 * calibration script (scripts/ad-review-calibrate.ts) runs the very questions the review sends.
 * Jev is TypeSafe's decision model: each question is a typed yes/no (`noul`) answered as a probability. ONE call per
 * review carries every question below over the ad's WORDS (headline, body, advertiser, legal name, permit number, the
 * landing page's address, <title> and meta description); the picture goes to Gemini (ai-moderation.ts moderateListing).
 *
 * Three families:
 *   BANNED — Vietnamese law forbids advertising it (the Advertising Law's Art. 7, the e-cigarette ban of Resolution
 *            173/2024, the rules on breast-milk substitutes for children under 24 months, the Weapons Law) — and, on
 *            eno, visa and legal-permit services (the aisles listing ads exclude, book.ts AD_EXCLUDED_SUBCATEGORIES): REFUSED;
 *   CLAIMS — Art. 8 (prohibited acts: unproven "best / number one", direct comparison, national symbols, maps) plus
 *            misleading or guaranteed claims: REFUSED;
 *   PERMIT — lawful only with the sector's ad-content confirmation (medicines, cosmetics, food supplements, medical
 *            devices and services, finance, real-estate projects, study and work abroad, pesticides, veterinary drugs,
 *            fertiliser, household insecticides). ⛔ ALLOWED SINCE THE OWNER'S 2026-11-25 CHANGE ("permit categories are
 *            now allowed"): the classes a creative falls in are RECORDED (`scores.permitClasses`) and shown to admins with
 *            the optional `permitRef`; they never refuse an ad.
 *
 * ⛔ THE MODEL IS PINNED (JEV_AD_MODEL) AND THE THRESHOLDS BELONG TO IT. MEASURED 2026-11-25 on the live model (36 hand-made
 * samples, creative-review.fixture.ts, scripts/ad-review-calibrate.ts run inside the production container): EVERY banned and
 * claim class had a labelled sample (visa_legal: evisa 0.98); every labelled unlawful sample ≥ 0.87, every lawful sample ≤ 0.07 except one claim score of 0.15 (laundry-vi, misleading) — wide margins
 * on both sides of 0.5 / 0.6. Not measured (no labelled sample): medicine, pesticides, veterinary, fertiliser, household
 * insecticide — PERMIT classes, which only tag an ad. A new model, a reworded question or a new threshold needs a new run.
 */
export const JEV_AD_MODEL = 'jev-1.14.0'
export const JEV_AD_THRESHOLDS = { banned: 0.5, claim: 0.6, permit: 0.5 } as const
/**
 * ⛔ THE MEASUREMENT THE THRESHOLDS WERE PINNED FROM — null until scripts/ad-review-calibrate.ts has run against the live
 * model and separated every class. While null the review sells nothing (creative-review.ts answers review_unavailable;
 * AD_REVIEW_ALLOW_PROVISIONAL=1 lifts it for a local preview only). Set it with the thresholds, e.g.
 * `{ measuredOn: '2026-11-26', model: 'jev-1.14.0', samples: 30 }`.
 */
export const JEV_AD_CALIBRATION: { measuredOn: string; model: string; samples: number } | null = { measuredOn: '2026-11-25', model: 'jev-1.14.0', samples: 36 }

/**
 * The review's identity: the pinned models, the calibration (or `provisional`) and the thresholds. Stored on every creative
 * (`reviewModel`); a verdict is reused only under the SAME key, so a re-pin or a new model reviews again, and a creative
 * approved under provisional thresholds (a preview, AD_REVIEW_ALLOW_PROVISIONAL=1 — previews run on the live database) is
 * never offered a price, booked or served where that switch is off (provisionalReviewAllowed).
 */
export function adReviewKey(geminiModel: string): string {
  const t = JEV_AD_THRESHOLDS
  return `${JEV_AD_MODEL}+${geminiModel}@${JEV_AD_CALIBRATION?.measuredOn ?? 'provisional'}:t${t.banned}/${t.claim}/${t.permit}:q${jevQuestionsHash()}`
}
/** What Jev is asked, as a short hash (FNV-1a over the questions and the state's template): a reworded question or a new
 *  way of quoting the ad is a new review key, so no verdict given under the old wording is reused. Pure, no crypto. */
export const JEV_STATE_VERSION = 'state-v2:quoted-landing'
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
/** (Computed on first use: AD_QUESTIONS is declared further down.) */
let questionsHash: string | null = null
export const jevQuestionsHash = () => (questionsHash ??= fnv1a(JSON.stringify([JEV_STATE_VERSION, AD_QUESTIONS])))
export const isProvisionalReview = (reviewModel: string) => reviewModel.includes('@provisional')
export const provisionalReviewAllowed = () => process.env.AD_REVIEW_ALLOW_PROVISIONAL === '1'
/** May a creative reviewed under `reviewModel` be priced, booked or served here? */
export const reviewCountsHere = (reviewModel: string) => !isProvisionalReview(reviewModel) || provisionalReviewAllowed()

type Q = { family: 'banned' | 'claim' | 'permit'; instructions: string; refusal?: ReviewReasonCode }

export const AD_QUESTIONS = {
  tobacco: { family: 'banned', refusal: 'banned_tobacco', instructions: 'This ad promotes tobacco, cigarettes, cigars, e-cigarettes, vapes, pods, e-liquid, heated tobacco or shisha.' },
  alcohol: { family: 'banned', refusal: 'banned_alcohol', instructions: 'This ad promotes a drink of 15% alcohol by volume or more: spirits, liquor, whisky, vodka, rum, soju, strong rice wine. Beer and ordinary wine under 15% are NOT this.' },
  infant_formula: { family: 'banned', refusal: 'banned_infant_formula', instructions: 'This ad promotes breast-milk substitutes, infant formula, feeding bottles, teats, or food for babies under 24 months.' },
  prescription_drugs: { family: 'banned', refusal: 'banned_prescription_drugs', instructions: 'This ad promotes prescription-only medicines (antibiotics, sedatives, hormones, injectables, weight-loss or sexual-enhancement drugs) or medicines without a prescription that needs one.' },
  weapons: { family: 'banned', refusal: 'banned_weapons', instructions: 'This ad promotes weapons, firearms, ammunition, explosives, tasers, combat knives, realistic replica guns, or military or police uniforms and equipment.' },
  fireworks: { family: 'banned', refusal: 'banned_fireworks', instructions: 'This ad promotes fireworks or firecrackers.' },
  gambling: { family: 'banned', refusal: 'banned_gambling', instructions: 'This ad promotes gambling, betting, a casino, a lottery, an online betting or casino site, or games played for money.' },
  sexual: { family: 'banned', refusal: 'banned_sexual', instructions: 'This ad promotes sexual services, escorts, prostitution, sugar dating, pornography or other adult sexual content.' },
  drugs: { family: 'banned', refusal: 'banned_drugs', instructions: 'This ad promotes illegal drugs, narcotics, cannabis, laughing gas or drug precursors.' },
  counterfeit: { family: 'banned', refusal: 'banned_counterfeit', instructions: 'This ad promotes counterfeit, replica, "super fake" or 1:1 branded goods, or forged documents, diplomas, IDs, invoices or seals.' },
  wildlife: { family: 'banned', refusal: 'banned_wildlife', instructions: 'This ad promotes wild or protected animals or wildlife products such as ivory, rhino horn, pangolin, tiger, bear bile or shark fin.' },
  mlm: { family: 'banned', refusal: 'banned_mlm', instructions: 'This ad recruits people into multi-level marketing or a pyramid scheme, where income comes from recruiting others.' },
  debt_collection: { family: 'banned', refusal: 'banned_debt_collection', instructions: 'This ad offers debt-collection services.' },
  spy_devices: { family: 'banned', refusal: 'banned_spy_devices', instructions: 'This ad promotes hidden cameras, spy or eavesdropping devices, covert trackers, or signal or GPS jammers.' },
  visa_legal: { family: 'banned', refusal: 'banned_visa_legal', instructions: 'This ad offers visa, e-visa, visa-run, work-permit, residence-card or other immigration or legal-permit services.' },
  unlawful: { family: 'banned', refusal: 'banned_unlawful', instructions: 'This ad offers something else illegal in Vietnam: human or organ trade, personal data or customer lists, pre-activated SIM cards, unlicensed currency or crypto trading, hacking, loan sharking, or content against the state.' },
  superlative: { family: 'claim', refusal: 'claim_superlative', instructions: 'This ad claims to be the best, number one, #1, top, leading, the cheapest or similar ("nhất", "tốt nhất", "số 1") WITHOUT naming the ranking, award or survey and its source that proves it.' },
  comparison: { family: 'claim', refusal: 'claim_comparison', instructions: 'This ad directly compares itself with a named competitor, another brand, or another company\'s product.' },
  national_symbols: { family: 'claim', refusal: 'claim_national_symbols', instructions: 'This ad uses or mentions Vietnam\'s national flag, emblem or anthem, the Party, or the names or images of national leaders.' },
  map: { family: 'claim', refusal: 'claim_map', instructions: 'This ad uses or mentions a map of Vietnam or claims about its borders, seas or islands.' },
  misleading: { family: 'claim', refusal: 'claim_misleading', instructions: 'This ad makes a misleading or guaranteed claim: guaranteed results, cures a disease, guaranteed profit or income, "100% effective", "risk-free", or a fake discount.' },
  medicine: { family: 'permit', instructions: 'This ad promotes a medicine, pharmacy product or drug (any kind).' },
  cosmetics: { family: 'permit', instructions: 'This ad promotes cosmetics or skin, hair or beauty care products.' },
  supplements: { family: 'permit', instructions: 'This ad promotes food supplements, functional food, vitamins or health-protection food.' },
  medical: { family: 'permit', instructions: 'This ad promotes medical devices, or medical, dental, clinic, hospital or aesthetic-treatment services.' },
  finance: { family: 'permit', instructions: 'This ad promotes banking, loans, credit, insurance, investment, securities or other financial services.' },
  real_estate_project: { family: 'permit', instructions: 'This ad promotes a real-estate development project for sale (apartments, villas or land plots in a project), not one rental or one home.' },
  study_work_abroad: { family: 'permit', instructions: 'This ad promotes study-abroad or work-abroad (labour export) services.' },
  pesticides: { family: 'permit', instructions: 'This ad promotes pesticides or plant-protection chemicals.' },
  veterinary: { family: 'permit', instructions: 'This ad promotes veterinary drugs or animal medicines.' },
  fertiliser: { family: 'permit', instructions: 'This ad promotes fertiliser.' },
  household_insecticide: { family: 'permit', instructions: 'This ad promotes household insecticides or disinfectants (mosquito, cockroach or ant killers).' },
} as const satisfies Record<string, Q>

export type AdQuestionKey = keyof typeof AD_QUESTIONS
export const AD_QUESTION_KEYS = Object.keys(AD_QUESTIONS) as AdQuestionKey[]
export const PERMIT_CLASSES = AD_QUESTION_KEYS.filter((k) => AD_QUESTIONS[k].family === 'permit')

/** The request body's `questions`: every class, as Jev's typed yes/no. */
export function jevAdQuestions(): Record<string, { type: 'noul'; instructions: string }> {
  return Object.fromEntries(AD_QUESTION_KEYS.map((k) => [k, { type: 'noul' as const, instructions: AD_QUESTIONS[k].instructions }]))
}

export type AdWords = {
  advertiserName: string; legalName: string; headline: string; body?: string | null; permitRef?: string | null
  landingHost: string; landingFinalHost?: string | null; landingTitle?: string | null; landingDescription?: string | null
}

/** What Jev reads: the ad as a viewer would, then where it leads. Cut so one review stays a few hundred tokens. */
export function jevAdState(w: AdWords): string {
  const line = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n) || '—'
  return [
    'An advertisement in the feed of a Vietnamese marketplace.',
    `Advertiser: ${line(w.advertiserName, 40)} (registered as ${line(w.legalName, 120)})`,
    `Headline: ${line(w.headline, 60)}`,
    `Text: ${line(w.body, 120)}`,
    ...(w.permitRef ? [`Ad permit or confirmation number: ${line(w.permitRef, 80)}`] : []),
    `Landing page: https://${line(w.landingHost, 253)}`,
    // Where its redirects ended, when that is somewhere else (an innocent address that forwards to a casino).
    ...(w.landingFinalHost && w.landingFinalHost !== w.landingHost ? [`Landing page after redirects: https://${line(w.landingFinalHost, 253)}`] : []),
    // ⛔ Quoted as data: the advertiser wrote these, and an instruction in a <title> must not read as one.
    `Landing page title (quoted, written by the advertiser): ${JSON.stringify(line(w.landingTitle, 200))}`,
    `Landing page description (quoted, written by the advertiser): ${JSON.stringify(line(w.landingDescription, 300))}`,
  ].join('\n')
}

const probability = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null)

/** Jev's answers as one probability per class, or null when ANY class is missing or malformed (the review fails closed). */
export function readJevAnswers(answers: unknown): Record<AdQuestionKey, number> | null {
  const a = answers as Record<string, { noul?: unknown }> | null | undefined
  const out = {} as Record<AdQuestionKey, number>
  for (const k of AD_QUESTION_KEYS) {
    const p = probability(a?.[k]?.noul)
    if (p === null) return null
    out[k] = p
  }
  return out
}

/** The verdict the words carry: the refusals (banned classes and claims over their thresholds) and the permit classes. */
export function jevAdVerdict(scores: Record<AdQuestionKey, number>): { refusals: ReviewReasonCode[]; permitClasses: AdQuestionKey[] } {
  const refusals: ReviewReasonCode[] = []
  const permitClasses: AdQuestionKey[] = []
  for (const k of AD_QUESTION_KEYS) {
    const q: Q = AD_QUESTIONS[k]
    const p = scores[k]
    if (q.family === 'permit') { if (p >= JEV_AD_THRESHOLDS.permit) permitClasses.push(k); continue }
    if (p >= (q.family === 'banned' ? JEV_AD_THRESHOLDS.banned : JEV_AD_THRESHOLDS.claim) && q.refusal) refusals.push(q.refusal)
  }
  return { refusals, permitClasses }
}
