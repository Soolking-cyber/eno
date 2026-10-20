import 'server-only'
import { createHash } from 'node:crypto'

/**
 * LAYA ON THE BOX — the second reader of a job post (owner, 2026-10-20: "a matching algorythm with laya in the box").
 *
 * Laya (convaiinnovations/laya-multilingual, Apache-2.0, 322M) runs in its own container on the production box
 * (infra/vn-node/laya-server, `eno-laya` on the supabase_default network) and answers TYPED questions about a post in
 * one forward pass: a probability per option. Nothing leaves the box.
 *
 * ⛔ IT IS NEVER THE DECIDER, AND SINCE ITS MEASUREMENT NOT EVEN A VETO (facts.ts LAYA_ROLE = 'record'). Zero-shot it is
 * uncalibrated: on the 270 blind-labelled posts (2026-10-20) its reading of what a post is was right 40 % of the time,
 * and as a veto it held 32 good posts and no bad one. Every run still asks it, and its answers are stored beside the
 * rules' (ExternalJobPost.facts.laya) — the record a calibration or a fine-tune needs before it earns a role.
 * ⚠️ UNREACHABLE OR SLOW = NOT AVAILABLE, never an error that stops matching: a post it did not reach is stored without
 * its answers, and the rules decide alone.
 */

export const LAYA_QUESTIONS = {
  kind: {
    type: 'choice',
    instructions: 'What is `post` (a message in a Facebook group about English-teaching jobs in Vietnam)?',
    criteria: {
      hiring: 'a school, language centre, company or recruiter advertising a teaching job (full-time, part-time, online or private tutoring)',
      cover: 'an urgent request for a cover or substitute teacher for specific classes or dates',
      seeker: 'a teacher describing themselves and looking for work, classes or students',
      other: 'anything else: a question, an advert for a service, news, a visa or housing post, spam',
    },
  },
  poster: {
    type: 'choice',
    instructions: 'Who wrote `post`?',
    criteria: {
      school: 'a school, kindergarten, language centre or company that will employ the teacher itself',
      agency: 'a recruiter or agency placing teachers with other schools',
      teacher: 'a teacher asking someone to cover their own class, or a teacher looking for work',
      parent: 'a parent or a student looking for a private tutor',
      unclear: 'cannot tell',
    },
  },
  native: {
    type: 'choice',
    instructions: 'Does `post` require the teacher to be a native English speaker?',
    criteria: { required: 'yes, native speakers only or native required', preferred: 'native speakers preferred but others considered', not_stated: 'not stated, or non-native speakers are welcome' },
  },
  degree: {
    type: 'choice',
    instructions: 'Does `post` require a university degree?',
    criteria: { required: 'yes, a degree is required', preferred: 'a degree is a plus', not_stated: 'not stated' },
  },
  tefl: {
    type: 'choice',
    instructions: 'Does `post` require a teaching certificate (TEFL, TESOL, CELTA or similar)?',
    criteria: { required: 'yes, a certificate is required', preferred: 'a certificate is a plus', not_stated: 'not stated' },
  },
} as const

export type LayaQuestion = keyof typeof LAYA_QUESTIONS
/** Characters of a post Laya reads (~300 tokens per question, well inside its 1,024-token window). */
export const STATE_CHARS = 1200
export type LayaAnswers = { [Q in LayaQuestion]: Record<keyof (typeof LAYA_QUESTIONS)[Q]['criteria'], number> }

const QUESTIONS_SHA = createHash('sha256').update(JSON.stringify(LAYA_QUESTIONS)).digest('hex').slice(0, 8)

type Health = { ok: boolean; model: string; revision: string }
type Predict = { engine: string; results: Array<{ answers: Record<string, { probabilities?: Record<string, number> }> }> }

/**
 * The engine URL, or null when this deployment has no Laya (LAYA_ENGINE_URL unset — local dev, eno.forum).
 * ⛔ ONLY THE BOX'S OWN ENGINE: the post text goes to it, and "nothing leaves the box" must not rest on the env alone
 * (codex, gates 1b and 1c) — the `eno-laya` container (apps.compose.yml) or a loopback address for a local run; any other
 * host, private network or not, reads as no engine.
 */
export function layaUrl(): string | null {
  const u = (process.env.LAYA_ENGINE_URL || '').trim().replace(/\/+$/, '')
  if (!u) return null
  try {
    const { protocol, hostname } = new URL(u)
    if (protocol !== 'http:' && protocol !== 'https:') return null
    const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return h === 'eno-laya' || h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h) ? u : null
  } catch {
    return null
  }
}

/** `<model>@<revision>#q<questions sha>` — stored with every answer so a model or question change re-reads posts. */
export async function layaEngineId(base: string): Promise<string | null> {
  try {
    // ⛔ redirect 'error': a 3xx from anything answering as the engine must not carry the request — or a post — elsewhere
    // (codex + opus, gate 1d).
    const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5_000), redirect: 'error' })
    if (!r.ok) return null
    const h = (await r.json()) as Health
    return h.ok ? `${h.model}@${h.revision}#q${QUESTIONS_SHA}` : null
  } catch {
    return null
  }
}

/**
 * Laya's answers for each text, in order — null for a text it did not reach (the engine stopped answering, answered
 * malformed, or the call's time budget ran out); null for the whole batch when there is no engine.
 * ⚠️ SIZED FROM MEASUREMENTS (laya-server/README.md, 2026-10-20, a loaded Mac): ~1.2–4.5 s per post for these five
 * questions, and a 3,000-character post cost 36 s — so each post is cut to STATE_CHARS (the facts a job post leads
 * with), chunks are 4 posts, and the whole call stops asking after `budgetMs` (4 minutes): a slow engine costs a run
 * minutes, never its 15-minute window, and the posts it did not reach are simply stored without its answers.
 */
export async function layaAnswers(texts: readonly string[], opts: { timeoutMs?: number; budgetMs?: number } = {}): Promise<{ engine: string; answers: (LayaAnswers | null)[] } | null> {
  const base = layaUrl()
  if (!base || !texts.length) return null
  const engine = await layaEngineId(base)
  if (!engine) return null
  const answers: (LayaAnswers | null)[] = texts.map(() => null)
  const deadline = Date.now() + (opts.budgetMs ?? 240_000)
  for (let i = 0; i < texts.length; i += 4) {
    const left = deadline - Date.now()
    if (left <= 0) break
    const chunk = texts.slice(i, i + 4)
    try {
      const r = await fetch(`${base}/v1/predict`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ states: chunk.map((post) => ({ post: post.slice(0, STATE_CHARS) })), questions: LAYA_QUESTIONS }),
        signal: AbortSignal.timeout(Math.min(opts.timeoutMs ?? 300_000, left)),
        redirect: 'error',
      })
      if (!r.ok) break
      const body = (await r.json()) as Predict
      if (!Array.isArray(body.results) || body.results.length !== chunk.length) break
      body.results.forEach((res, j) => { answers[i + j] = parseAnswers(res.answers) })
    } catch {
      break
    }
  }
  return { engine, answers }
}

function parseAnswers(raw: Predict['results'][number]['answers']): LayaAnswers | null {
  const out: Partial<LayaAnswers> = {}
  for (const q of Object.keys(LAYA_QUESTIONS) as LayaQuestion[]) {
    const p = raw?.[q]?.probabilities
    if (!p) return null
    const opts = Object.keys(LAYA_QUESTIONS[q].criteria)
    const row: Record<string, number> = {}
    for (const o of opts) {
      const v = p[o]
      if (typeof v !== 'number' || !Number.isFinite(v)) return null
      row[o] = v
    }
    ;(out as Record<string, unknown>)[q] = row
  }
  return out as LayaAnswers
}

export { top } from './laya-top'
