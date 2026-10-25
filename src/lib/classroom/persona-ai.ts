import 'server-only'
import { Type, type GoogleGenAI, type Schema } from '@google/genai'
import { askJsonOnce, dataPart, hedgedAnswer, str, ThinkingLevel, type JsonAsk } from './ai'
import { PACE_LABEL, PERSONA_MAX, TONE_LABEL, TOPIC_LABEL, type Traits } from './persona'
import { containsContactInfo } from '@/lib/publish-guard'
import { containsPhoneNumber } from '@/lib/phone'

/**
 * WRITE WITH AI — the avatar's persona, drafted by Gemini 3.8 Flash from the teacher's own profile and the chips they
 * picked (owner: "assisted with ai writing use 3.8flash api"). The teacher reads and edits it before saving; nothing is
 * stored from here (the route answers the draft; PUT /api/classroom/avatar saves what the teacher keeps).
 */

export type PersonaRequest = {
  avatarName: string
  traits: Traits
  /** Facts from the TeacherProfile, already reduced to plain lines (no name, phone, email or photo — route.ts). */
  facts: string[]
  /** What the teacher wrote in the persona box so far (may be empty) — the draft keeps their meaning. */
  ownText: string
}

export const PERSONA_INSTRUCTION = `You write the CHARACTER NOTE for an AI speaking-practice avatar that an English teacher in Vietnam uses with their own students between lessons. The avatar talks with the students by voice; another AI plays the avatar using your note. Return JSON: {"persona": "...", "greeting": "..."}.

"persona" — 70 to 150 words, in English, written as instructions to the avatar ("You are …", "You …"). Describe: how the avatar talks (the tone and pace chosen), what it likes to chat about (the chosen topics, plus anything true about the teacher in the data), how it encourages students, and one or two habits that make it feel like this teacher (e.g. asks follow-up questions, uses everyday examples). Use only facts from the data and the teacher's own note; never invent a hometown, a family, a hobby, an exam, a qualification or a number that is not there. Keep the teacher's own note's meaning when there is one.
"greeting" — the avatar's first line to a student, at most 25 words, friendly, ending with an easy question.

Rules: no names of real students, no contact details, links or social media, no salary, no promises about results or exams, no claim to be human — the avatar is an AI version of the teacher. Plain sentences only: no lists, headings, quotes, emojis or placeholders like [name].`

const SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { persona: { type: Type.STRING }, greeting: { type: Type.STRING } },
  required: ['persona', 'greeting'],
}

export function personaAsk(req: PersonaRequest, retryNote?: string): JsonAsk {
  const chips = [
    `Avatar name: ${req.avatarName || '(not set)'}`,
    `Tone: ${TONE_LABEL[req.traits.tone].en}`,
    `Pace: ${PACE_LABEL[req.traits.pace].en}`,
    `Topics: ${req.traits.topics.map((t) => TOPIC_LABEL[t].en).join(', ') || '(none)'}`,
  ].join('\n')
  const data = ['TEACHER PROFILE:', ...(req.facts.length ? req.facts.map((f) => `- ${f}`) : ['- (none)']), '', 'CHOSEN CHIPS:', chips, '', "THE TEACHER'S OWN NOTE:", req.ownText || '(empty)'].join('\n')
  return {
    system: PERSONA_INSTRUCTION,
    contents: [{ role: 'user', parts: [dataPart('TEACHER DATA', data), { text: `Write the character note and greeting described in your instructions.${retryNote ? ` ${retryNote}` : ''}` }] }],
    schema: SCHEMA,
    maxOutputTokens: 4_096,
    thinking: ThinkingLevel.LOW,
  }
}

export type PersonaRejection = 'empty' | 'length' | 'contact' | 'placeholder'

/** The output gate: a draft the teacher may keep, or why not. Pure. */
export function acceptPersona(value: Record<string, unknown>): { ok: true; persona: string; greeting: string } | { ok: false; reason: PersonaRejection } {
  const persona = str(value, 'persona', PERSONA_MAX)
  const greeting = str(value, 'greeting', 200)
  if (!persona || !greeting) return { ok: false, reason: 'empty' }
  const words = persona.split(/\s+/).length
  if (words < 40 || words > 190 || greeting.split(/\s+/).length > 30) return { ok: false, reason: 'length' }
  const both = `${persona}\n${greeting}`
  if (containsPhoneNumber(both) || containsContactInfo(both)) return { ok: false, reason: 'contact' }
  // Lists and headings are looked for in the RAW text (2a round 2, opus): str() has already folded the lines into one.
  const raw = [value.persona, value.greeting].filter((x): x is string => typeof x === 'string').join('\n')
  if (/[[\]{}<>]/.test(both) || /^\s*(?:#|[-*•]\s)/m.test(raw)) return { ok: false, reason: 'placeholder' }
  return { ok: true, persona, greeting }
}

const RETRY_NOTE: Record<PersonaRejection, string> = {
  empty: 'Your previous answer could not be used. Fill both fields with plain sentences.',
  length: 'Your previous answer had the wrong length: persona 70–150 words, greeting at most 25 words.',
  contact: 'Your previous answer contained contact details. Remove every phone number, email, link and social handle.',
  placeholder: 'Your previous answer contained brackets, placeholders, headings or a list. Write plain sentences only.',
}

export type PersonaDraft =
  | { ok: true; persona: string; greeting: string; model: string; calls: number }
  | { ok: false; failure: 'model'; calls: number; error: unknown }
  | { ok: false; failure: 'rejected'; reason: PersonaRejection; calls: number }

/** The draft: hedged first answer, then ONE retry told why when the gate refuses it. Never throws for the model's sake. */
export async function draftPersona(ai: GoogleGenAI, req: PersonaRequest): Promise<PersonaDraft> {
  const H = { primaryMs: 20_000, hedgeMs: 9_000, backupMs: 15_000, fallbackMs: 12_000 }
  let calls = 0
  let first
  try {
    first = await hedgedAnswer((model, timeout, signal) => askJsonOnce(ai, personaAsk(req), model, timeout, signal), H)
    calls += first.calls
  } catch (error) {
    return { ok: false, failure: 'model', calls: calls + 1, error }
  }
  const verdict = acceptPersona(first.value)
  if (verdict.ok) return { ...verdict, model: first.model, calls }
  try {
    const again = await hedgedAnswer((model, timeout, signal) => askJsonOnce(ai, personaAsk(req, RETRY_NOTE[verdict.reason]), model, timeout, signal), { ...H, hedgeMs: 8_000 })
    calls += again.calls
    const second = acceptPersona(again.value)
    return second.ok ? { ...second, model: again.model, calls } : { ok: false, failure: 'rejected', reason: second.reason, calls }
  } catch (error) {
    // The retry's call itself failed: a model failure, not a content refusal (2a round 7, opus).
    return { ok: false, failure: 'model', calls: calls + 1, error }
  }
}
