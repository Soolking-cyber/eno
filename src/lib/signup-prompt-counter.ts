import 'server-only'
import { kv } from '@/lib/ratelimit'
import { EDITION } from '@/lib/edition'
import { counterKey, gateCounterKey, vnDay, type GateAction, type SignInGate, type SignupPromptCounterEvent } from '@/lib/signup-prompt'

// ── The "Join eno" prompt's anonymous daily totals ────────────────────────────────────────────────
//
// Owner, 2026-10-01: review after one week "how many pressed x, bounced, and how many signed up".
// GA cannot answer that honestly — it only sees visitors who switched Analytics on — so these are
// counted here as well, without consent, which is defensible ONLY because nothing about the visitor
// is kept: one integer per (Vietnam day, edition, event, coarse context class). No IP, no user id, no
// cookie, no user agent, no page. The route reads the IP for its rate limit like every endpoint
// (rl_window, minutes) and stores none of it here. /privacy says so ("Sign-up reminder counts").
// ⚠️ THE CONTEXT CLASS (UX3 J1, 2026-10-05) is one of 24 fixed values — what kind of browser
// (in-app Facebook / Zalo / other, browser, home-screen app, the eno app) × phone or desktop × vi or
// en — validated against that closed set in signup-prompt.ts before it can reach a key, so a key can
// carry nothing a client made up.
//
// ⚠️ kv_store, NOT A NEW TABLE (owner: no Prisma model, no DDL). `kv.incrby` is the counter primitive
// the repo already runs on (spam counters, daily budgets). ⚠️ kv_store is UNLOGGED: it survives
// restarts and deploys, but an UNCLEAN Postgres shutdown (crash recovery) truncates it and these
// totals restart from zero. For a one-week tuning read that is acceptable; the durable LOGGED
// alternative here, publish_funnel, was rejected because the admin publish funnel reads every outcome
// that is not 'published' as a publish refusal. If these numbers ever matter beyond tuning, give them
// their own LOGGED table.
//
// Keys outlive the review comfortably and then expire on their own (the rl-kv-sweep cron).
const COUNTER_TTL_SEC = 400 * 24 * 60 * 60

/** +1 on today's total. Throws on a database fault — the route swallows it (a counter never errors). */
export async function recordSignupPromptEvent(event: SignupPromptCounterEvent, ctx: string, now: number = Date.now()): Promise<void> {
  await kv.incrby(counterKey(vnDay(now), EDITION, event, ctx), 1, COUNTER_TTL_SEC)
}

/** +1 on today's total for one sign-in gate's action (UX3 J1). Same contract as above. */
export async function recordSignInGateEvent(gate: Exclude<SignInGate, 'timed'>, action: GateAction, ctx: string, now: number = Date.now()): Promise<void> {
  await kv.incrby(gateCounterKey(vnDay(now), EDITION, gate, action, ctx), 1, COUNTER_TTL_SEC)
}
