import 'server-only'
// Relative specifiers throughout (the crypto.ts / schema.ts / dm-thread.ts / dm-flow.ts
// idiom): every branch below is unit-tested in concierge.test.ts and the sibling modules
// are mocked by the same specifier the source uses. Same modules either way.
import { db } from '../db'
import { getGemini, GEMINI_MODEL } from '../gemini'
import { insertMessage } from '../messages'
import { rateLimit } from '../ratelimit'
import { resolveVisaProduct, getVisaShopSeller, type VisaShopProduct } from '../visa-shop'
import { visaCryptoReady } from './crypto'
import { loadVisaDmCase, selectedVisaDmListingId } from './dm-flow'
import { firstIncompleteVisaDmStep, VISA_DM_STEP_ISSUES, type VisaDmDoc, type VisaDmStep } from './dm-steps'
import { getVisaThreadMode,
  readVisaThreadModeStrict, type VisaThreadMode } from './dm-thread'
import { recordVisaEvent } from './records'
import { MAX_EVISA_VALIDITY_DAYS, validateVisaForReview, type VisaPayload } from './schema'
import { VISA_SPEED_SPECS, type VisaSpeedCode } from './speed'

// ── ENO CONCIERGE — the e-Visa assistant inside the thread ─────────────────────────
//
// The owner's ask, verbatim: "also hook ai gemini 3.5 flash there so it can answer all
// related latest updates about visa application name is Eno concierge" and "ife person
// requested ai doesnt answer / so there is 2 chips human request Eno AI concierge".
//
// Two chips sit above the composer. One asks a PERSON (the existing /help route, which
// flips the thread's mode to 'human_requested'). The other asks ENO CONCIERGE — this
// module. They are alternatives, not companions, and the whole design turns on that:
//
// ⚠️ THE MODE GATE IS THE POINT OF THIS FILE (the owner stated it twice). A thread whose
// mode is 'human_requested' or 'admin' gets NO concierge answer — not a shorter one, not a
// "a human will follow up" one: nothing is generated and nothing is written. Somebody asked
// for a human; a bot answering over the top of that request is the failure, not a fallback.
// The gate lives in askVisaConcierge (below), before any write and before any AI spend, so
// the route cannot forget it and a future second caller inherits it for free.
//
// ⚠️ NO PII EVER REACHES THE MODEL. This module DECRYPTS the payload — it must, because
// "what do I still need?" is a function of the answers — and every value it reads dies
// inside the validator. What travels to Gemini is enumerated exactly in
// visaConciergePrompt(): a step number, a constant step title, the application's workflow
// status word, a paid boolean, VALIDATOR ISSUE CODES (which name fields, e.g.
// 'passport_number_required'), the bought product's entry type / speed / cutoffs / window,
// the 90-day constant, and the applicant's own scrubbed question. No name, no passport
// number, no date of birth, no address, no email, no application id, no user id.
//
// ⚠️ FAILS CLOSED, ALWAYS. Gemini unconfigured, over budget, erroring, or answering with
// nothing ⇒ 'concierge_unavailable' and no message. There is no canned "here is how visas
// work" fallback anywhere in this file and there must never be one: a confident wrong
// answer about a government form is worse than no answer, and the applicant is one tap away
// from a human.

/** The attribution every generated answer carries. Persisted, so it is language-neutral. */
export const VISA_CONCIERGE_LABEL = '✨ Eno concierge'

/** Cap on the question that reaches the prompt (the stored message keeps its own cap). */
export const VISA_CONCIERGE_QUESTION_MAX = 500

/** Cap on the generated answer, applied before it is written into a Message body. */
const ANSWER_MAX_CHARS = 1200

/** What the applicant is looking at, per step. Model-facing, so English only. */
const STEP_TITLE: Record<VisaDmStep, string> = {
  1: 'Documents — passport data page photo and portrait photo',
  2: 'Confirm the passport details we read from the photo',
  3: 'About you — declarations, home address, contacts, work',
  4: 'Your trip — dates, entry/exit gates, where you will stay, expenses',
  5: 'Review and pay',
}

const ALL_STEPS: readonly VisaDmStep[] = [1, 2, 3, 4, 5]

export type VisaConciergeErrorCode =
  | 'admin_takeover'
  | 'concierge_unavailable'
  | 'human_help_pending'
  | 'internal_error'
  | 'not_found'
  | 'question_required'
  | 'shop_unavailable'
  | 'thread_conflict'
  | 'thread_not_bound'
  | 'visa_encryption_not_configured'

export type VisaConciergeResult =
  | { ok: true; messageId: string; step: VisaDmStep }
  | {
    ok: false
    error: VisaConciergeErrorCode
    status: number
    /**
     * The applicant's question is already in the thread even though no answer is.
     * The client says "we could not answer, a person can" instead of "nothing happened".
     */
    questionPosted?: boolean
  }

const fail = (error: VisaConciergeErrorCode, status: number, extra?: { questionPosted?: boolean }): VisaConciergeResult =>
  ({ ok: false, error, status, ...extra })

// ── The question ──────────────────────────────────────────────────────────────────

/**
 * The applicant's question, with the shapes that carry identity documents redacted.
 *
 * ⚠️ WHY THIS EXISTS. Everything else this module sends to Gemini is server-derived and
 * provably value-free. The question is the one free-text field, and an applicant CAN type
 * "is passport C01234567 ok?" into it. That string is theirs and belongs in their own chat
 * (it is stored verbatim, exactly like the note on /help — their message, their thread), but
 * it must not travel to a third-party model. So the STORED message and the PROMPTED question
 * are deliberately two different strings, and this is the only producer of the second one.
 *
 * Best-effort by nature: no regex knows a human name. It removes the machine-readable
 * identifiers (passport/ID numbers, emails, phone numbers, long digit runs) and the prompt
 * separately forbids the model from repeating or asking for personal details. Short date
 * fragments survive on purpose — "can I enter on 23/07?" is the question, not the leak.
 */
export function scrubVisaConciergeQuestion(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, VISA_CONCIERGE_QUESTION_MAX)
    // email
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[removed]')
    // passport / national-id shape: 1-2 letters then 6-9 digits, WITH OR WITHOUT separators.
    // ⚠️ The separator tolerance is not cosmetic — an adversarial review typed
    // "my passport is C 0123 4567" and watched it reach the model untouched, because the
    // original pattern only matched the compact form. People space out document numbers
    // exactly as they appear on the document.
    .replace(/\b[A-Za-z]{1,2}[\s.-]?\d[\d\s.-]{4,}\d\b/g, '[removed]')
    // international phone
    .replace(/\+\d[\d\s().-]{6,}\d/g, '[removed]')
    // ANY run of 6+ digits once separators are discounted — ID numbers are commonly typed
    // in groups ("123 456 789 012"), which slipped past a bare \d{6,}.
    .replace(/\b\d[\d\s.-]{4,}\d\b/g, (m) => (m.replace(/\D/g, '').length >= 6 ? '[removed]' : m))
    .replace(/\d{6,}/g, '[removed]')
}

/**
 * Does this question look like it carries the applicant's IDENTITY rather than a query?
 *
 * ⚠️ Why a refusal and not more regex. Scrubbing catches machine-readable shapes; no regex
 * knows a human name, and an adversarial review demonstrated exactly that — "My name is John
 * Michael Smith, born 1990-03-12, I live at 42 Nguyen Hue" survived every pattern above. The
 * standing rule for this feature is that applicant VALUES never reach a third-party model, so
 * where scrubbing cannot guarantee it, the concierge declines to send the question at all and
 * points at the desk. Losing an AI answer costs a tap; leaking a passport holder's identity to
 * Vertex cannot be undone.
 *
 * Deliberately narrow, in BOTH directions:
 *  · it keys on people ANNOUNCING identity ("my name is", "I was born", "I live at"), not on
 *    any mention of a place or a date — "can I enter on 23/07?" and "how long from Hanoi?"
 *    must still be answerable, or the feature is useless.
 *  · it does NOT fire on "my passport is …". Document NUMBERS are exactly what the scrubber
 *    handles reliably, so refusing there would kill one of the commonest legitimate questions
 *    to prevent a leak that has already been prevented. Refusal is only for what no regex can
 *    redact: a human name, a birth date, a home address.
 */
const IDENTITY_DISCLOSURE_RE =
  /\b(?:my (?:full )?name is|i am called|i'?m called|my (?:date of birth|dob|birthday)|i was born(?: on| in)?|born on|d\.?o\.?b\.?|i live at|my address is|my home address|residing at)\b/i

export function questionDisclosesIdentity(raw: string): boolean {
  return IDENTITY_DISCLOSURE_RE.test((raw || '').replace(/\s+/g, ' '))
}

// ── The grounding ─────────────────────────────────────────────────────────────────

/** Operational facts about the product the applicant bought. All constants or public state. */
export type VisaConciergeProductFacts = {
  entryType: 'single' | 'multiple' | null
  speed: VisaSpeedCode | null
  /** Constant tier copy from speed.ts — never an admin-editable string. */
  speedLabel: string | null
  turnaround: string | null
  /** "HH:MM" wall-clock submission cutoffs, Asia/Ho_Chi_Minh. */
  cutoffs: readonly string[]
  acceptingNow: boolean | null
  nextOpensIso: string | null
}

/**
 * EVERYTHING the model is told about this case. Deliberately a NAMED TYPE with no index
 * signature: a reviewer can read this shape and know the whole blast radius, and a future
 * field cannot be added by accident inside a template string.
 */
export type VisaConciergeGrounding = {
  step: VisaDmStep
  stepTitle: string
  complete: boolean
  /** The application's workflow status word (draft / needs_changes / submitted / …). */
  status: string
  paid: boolean
  /** Outstanding VALIDATOR ISSUE CODES per step. Codes name fields; they never carry one. */
  outstanding: Array<{ step: VisaDmStep; codes: string[] }>
  product: VisaConciergeProductFacts | null
  maxValidityDays: number
}

/**
 * Turn a case into the facts above.
 *
 * ⚠️ THE VALUES ARE READ AND THROWN AWAY — the same discipline as visaDmStep2NeedsReview in
 * dm-flow.ts. `payload` goes into validateVisaForReview and nothing else; what comes back out
 * is a list of issue CODES from a frozen, code-owned vocabulary (dm-steps.ts). There is no
 * branch here that can put a payload value into the returned object.
 */
export function buildVisaConciergeGrounding(input: {
  payload: VisaPayload
  documents: VisaDmDoc[]
  status: string
  paid: boolean
  product: VisaShopProduct | null
}): VisaConciergeGrounding {
  const issues = validateVisaForReview(input.payload, input.documents)
  const outstanding: Array<{ step: VisaDmStep; codes: string[] }> = []
  for (const step of ALL_STEPS) {
    const owned = VISA_DM_STEP_ISSUES[step]
    const codes = issues.filter((issue) => owned.has(issue))
    if (codes.length) outstanding.push({ step, codes })
  }
  // The SAME step function the cards use, not a second opinion derived from the partition
  // above: the concierge saying "you are on step 3" while the live card says step 4 would be
  // the assistant contradicting the form it is meant to explain.
  const step = firstIncompleteVisaDmStep(input.payload, input.documents)
  const spec = input.product?.speed ? VISA_SPEED_SPECS[input.product.speed] : null
  return {
    step: step ?? 5,
    stepTitle: STEP_TITLE[step ?? 5],
    complete: step === null,
    status: input.status,
    paid: input.paid,
    outstanding,
    product: input.product
      ? {
        entryType: input.product.entryType,
        speed: input.product.speed,
        speedLabel: spec?.label ?? null,
        turnaround: spec?.turnaround ?? null,
        cutoffs: spec?.cutoffs ?? [],
        acceptingNow: input.product.window.acceptingNow,
        nextOpensIso: input.product.window.nextOpensIso,
      }
      : null,
    maxValidityDays: MAX_EVISA_VALIDITY_DAYS,
  }
}

/**
 * The prompt, in full. THIS FUNCTION IS THE PII AUDIT SURFACE: everything the model ever
 * sees is interpolated here and nowhere else, so a reviewer checks one function rather than
 * a whole request path.
 *
 * Interpolated, exhaustively: the answer language; the step number and its CONSTANT title;
 * the complete/paid booleans and the status word; outstanding VALIDATOR CODES; the product's
 * entry type, speed code, constant speed label, constant turnaround sentence, constant
 * cutoff times, accepting-now boolean and next-opens timestamp; the 90-day constant; and the
 * SCRUBBED question. Nothing else is in scope in this function.
 */
export function visaConciergePrompt(
  grounding: VisaConciergeGrounding,
  scrubbedQuestion: string,
  language: 'en' | 'vi',
): string {
  const product = grounding.product
  const outstanding = grounding.outstanding.length
    ? grounding.outstanding.map((row) => `  step ${row.step}: ${row.codes.join(', ')}`).join('\n')
    : '  none — every step is answered'
  return `You are "Eno concierge", the e-Visa assistant of eno.vn. You are talking to an applicant inside their own chat with the eno e-Visa desk, on a phone. Answer their question in ${language === 'vi' ? 'Vietnamese' : 'English'}.

WHAT YOU KNOW ABOUT THIS APPLICATION (field NAMES and state only — you hold NO personal data):
  current step: ${grounding.step} of 5 — ${grounding.stepTitle}
  all five steps answered: ${grounding.complete ? 'yes' : 'no'}
  application status: ${grounding.status}
  paid: ${grounding.paid ? 'yes' : 'no'}
  still outstanding (machine codes naming the missing fields):
${outstanding}

THE SERVICE THEY BOUGHT:
${product
    ? `  entry type: ${product.entryType ?? 'not chosen yet'}
  processing speed: ${product.speed ?? 'not chosen yet'}${product.speedLabel ? ` (${product.speedLabel})` : ''}
  turnaround: ${product.turnaround ?? 'unknown'}
  daily submission cutoffs (Asia/Ho_Chi_Minh wall clock): ${product.cutoffs.length ? product.cutoffs.join(', ') : 'none — no daily cutoff'}
  accepting submissions right now: ${product.acceptingNow === null ? 'unknown' : product.acceptingNow ? 'yes' : 'no'}
  next intake opens: ${product.nextOpensIso ?? 'n/a'}`
    : '  no product chosen yet'}

GENERAL VIETNAM e-VISA FACTS YOU MAY USE:
  · The e-visa is granted by the Vietnam Immigration Department. eno prepares and lodges the application; eno does not decide the outcome and cannot guarantee approval.
  · Maximum validity is ${grounding.maxValidityDays} days, single or multiple entry. The intended entry date must fall inside the visa validity window.
  · The applicant must be outside Vietnam when the application is lodged.
  · The passport must stay valid well past the visa period, and the passport photo and portrait must be readable.
  · The steps are always in this order: documents → confirm passport details → about you → your trip → review and pay. Payment is what sends the case to the eno desk.

HOW TO ANSWER:
  · Be concrete about THIS case: which step they are on, what is still missing (say the fields in plain words, from the codes above), and what happens next.
  · Under 90 words. Plain sentences, no markdown, no headings, no bullet characters, no sign-off — the message is already labelled Eno concierge.
  · NEVER state, guess or ask for a personal detail (name, passport number, date of birth, address, phone, email). You do not have them and must not pretend to.
  · NEVER quote a price, a fee or an exchange rate, and never promise approval or a specific approval date.
  · If the question is about money already paid, a refund, a rejected or submitted application, a legal question, or anything you cannot answer from the facts above, say so plainly in one sentence and tell them to tap "Request a person" in this chat.

THEIR QUESTION:
${scrubbedQuestion}`
}

// ── The gate ──────────────────────────────────────────────────────────────────────

/**
 * "IFE PERSON REQUESTED AI DOESNT ANSWER" (owner, twice).
 *
 * 'human_requested' — the applicant pressed the other chip. They asked for a person; the
 * concierge answering first is the bot deciding their request was unnecessary.
 * 'admin' — a specialist is in the thread. Same rule the wizard already obeys (dm-thread
 * refuses to author a step card in 'admin' mode).
 *
 * Note this is STRICTER than the step-card rule, which deliberately keeps working during
 * 'human_requested' so the applicant can fill the form while they wait. A form is furniture;
 * an assistant that talks is a voice, and only one voice may answer a request for a human.
 */
export function visaConciergeModeRefusal(mode: VisaThreadMode): VisaConciergeErrorCode | null {
  if (mode === 'admin') return 'admin_takeover'
  if (mode === 'human_requested') return 'human_help_pending'
  return null
}

// ── The call ──────────────────────────────────────────────────────────────────────

/**
 * One Gemini turn. Returns the answer text, or null — never a substitute answer.
 *
 * The GLOBAL daily budget breaker is the shopping concierge's idiom (src/app/api/ai/
 * concierge/route.ts): Gemini bills real money and this route is reachable by every
 * applicant, so a per-user limit alone is not a spend ceiling. strict:true means a limiter
 * outage denies rather than silently un-limits.
 */
async function generateVisaConciergeAnswer(prompt: string): Promise<string | null> {
  const ai = getGemini()
  if (!ai) return null
  const budget = await rateLimit('visa-concierge-gemini', 'global', 3000, '1 d', { strict: true })
  if (!budget.success) return null
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      // Low temperature: this answers questions about a government form, where invention is
      // the failure mode. thinkingBudget 0 keeps a chat reply chat-fast.
      config: { temperature: 0.2, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
    })
    const text = (res.text || '')
      .trim()
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```$/, '')
      // The label is added when the message is written; a model that opens with its own name
      // would double it.
      .replace(/^(✨\s*)?eno concierge\s*[:\-—]\s*/i, '')
      .trim()
    return text ? text.slice(0, ANSWER_MAX_CHARS) : null
  } catch (e) {
    // ⚠️ CODE ONLY. A Gemini error can echo the prompt back in its message, and the prompt
    // contains the applicant's own question — so the message is never logged.
    console.error('[visa-concierge] generation failed', (e as { name?: string })?.name ?? 'error')
    return null
  }
}

/**
 * Ask Eno concierge, and put the exchange in the thread.
 *
 * ⚠️ NOTHING HERE ASKS "WHO IS THE SESSION?" — the dm-flow.ts contract, inherited verbatim.
 * `userId` is an ALREADY-AUTHENTICATED actor: it is compared against
 * visa_applications.user_id (through loadVisaDmCase's scoped read) and against
 * Conversation.buyerProfileId, so a wrong id gets a refusal — but a route that passes an id
 * it never verified has already lost. Authentication belongs to the route.
 *
 * TWO MESSAGES, NOT AN EPHEMERAL BUBBLE, and that is a deliberate choice (owner: "so it can
 * answer … there"). The question is written as the APPLICANT'S OWN message and the answer as
 * the DESK'S account, prefixed with VISA_CONCIERGE_LABEL:
 *   · the desk can read what the bot told their applicant, and correct it in the same thread;
 *   · the answer survives a reload, a device change and the applicant closing the app;
 *   · the label means it can never be mistaken for a person's words — nothing else in this
 *     thread carries it, and the desk's own replies never do.
 * The question is posted BEFORE the model is called on purpose: if generation fails, their
 * question is still in front of a human instead of being swallowed with the composer text.
 */
export async function askVisaConcierge(input: {
  applicationId: string
  userId: string
  question: string
  language: 'en' | 'vi'
}): Promise<VisaConciergeResult> {
  const question = (input.question || '').trim().slice(0, VISA_CONCIERGE_QUESTION_MAX)
  if (!question) return fail('question_required', 400)
  // loadVisaDmCase decrypts; an env-less host must answer 503 rather than throw.
  if (!visaCryptoReady()) return fail('visa_encryption_not_configured', 503)

  // OWNERSHIP: scoped by user_id inside loadVisaDmCase — a case that is not theirs does not
  // exist here, so there is no branch that could answer about somebody else's application.
  const kase = await loadVisaDmCase(input.applicationId, input.userId)
  if (!kase) return fail('not_found', 404)

  // THE THREAD, via the @unique binding column — the help route's exact shape, because the
  // answer is authored INTO this conversation and insertMessage needs the row.
  const convo = await db.conversation.findUnique({
    where: { visaApplicationId: input.applicationId },
    select: { id: true, buyerProfileId: true, sellerProfileId: true, listingId: true },
  })
  if (!convo) return fail('thread_not_bound', 409)
  if (convo.buyerProfileId !== input.userId) return fail('thread_conflict', 409)

  // The desk seat must really BE the visa desk (resendVisaDmCard's check): the answer is
  // authored as the conversation's seller, so a thread whose seller is anyone else would put
  // an eno-branded message in a stranger's mouth.
  const shop = await getVisaShopSeller()
  if (!shop?.ownerId || shop.ownerId !== convo.sellerProfileId) return fail('shop_unavailable', 503)

  // ── THE GATE ─────────────────────────────────────────────────────────────────────
  // Before any write and before any AI spend. See visaConciergeModeRefusal.
  const mode = await getVisaThreadMode(input.applicationId)
  const refusal = visaConciergeModeRefusal(mode)
  if (refusal) return fail(refusal, 409)

  const listingId = await selectedVisaDmListingId(input.applicationId)
  const product = listingId ? await resolveVisaProduct(listingId) : null
  const grounding = buildVisaConciergeGrounding({
    payload: kase.payload,
    documents: kase.documents,
    status: kase.application.status,
    paid: !!kase.application.paid_at,
    product,
  })

  // The applicant's OWN words, in their OWN thread — stored verbatim, exactly like the note
  // on /help. (The MODEL gets the scrubbed copy below; the two strings are deliberately not
  // the same one.)
  await insertMessage(convo, input.userId, question)

  // ⚠️ IDENTITY DISCLOSURE → THE DESK, NOT THE MODEL. The question is now in the applicant's
  // own thread (their words, their chat — that is right, and the desk should see it), but if
  // it announces who they are, it does not go to Gemini at all. Scrubbing handles document
  // NUMBERS; it cannot handle "my name is …, born …, I live at …", which a review showed
  // travelling verbatim. Declining costs one tap to reach a human; the leak is permanent.
  if (questionDisclosesIdentity(question)) {
    return fail('human_help_pending', 409, { questionPosted: true })
  }

  const answer = await generateVisaConciergeAnswer(
    visaConciergePrompt(grounding, scrubVisaConciergeQuestion(question), input.language),
  )
  // FAIL CLOSED. No canned answer, no "probably", no partial guess about a visa rule.
  if (!answer) return fail('concierge_unavailable', 503, { questionPosted: true })

  // ── THE GATE, AGAIN ──────────────────────────────────────────────────────────────
  // ⚠️ RE-READ THE MODE. The check above happened BEFORE a multi-second model call, and the
  // owner's rule is about the moment the bot SPEAKS: "ife person requested ai doesnt answer".
  // The race is user-reachable, not theoretical — the two composer chips have independent
  // busy flags, so the applicant can ask, then tap "Request a person" while the model is
  // still thinking. /help writes human_requested, the model returns, and without this the
  // answer lands in a thread where a human was already asked for.
  //
  // The QUESTION stays (it is the applicant's own words, already posted, and the desk should
  // see what was asked). Only the bot's reply is dropped.
  const modeNow = await readVisaThreadModeStrict(input.applicationId)
  // A read that FAILED is not permission to speak — "could not tell" must not become
  // "carry on" for a voice. concierge_unavailable is the honest code: we did not answer.
  if (!modeNow.ok) return fail('concierge_unavailable', 503, { questionPosted: true })
  const refusalNow = visaConciergeModeRefusal(modeNow.mode)
  if (refusalNow) return fail(refusalNow, 409, { questionPosted: true })

  let messageId: string
  try {
    messageId = (await insertMessage(convo, shop.ownerId, `${VISA_CONCIERGE_LABEL}\n${answer}`)).id
  } catch (e) {
    console.error('[visa-concierge] answer not posted', e)
    return fail('internal_error', 500, { questionPosted: true })
  }

  // Best effort, the recordVisaResend rule: the answer is already in the thread, so a failed
  // audit insert must not turn a delivered answer into a 5xx the client would retry.
  // ⚠️ Metadata carries the step and the mode — public facts. Never the question, never the
  // answer, never a length that could fingerprint either.
  try {
    await recordVisaEvent(input.applicationId, 'applicant', 'dm_concierge_answered', input.userId, {
      step: grounding.step, mode,
    })
  } catch (e) {
    console.error('[visa-concierge] answer not recorded', e)
  }

  return { ok: true, messageId, step: grounding.step }
}
