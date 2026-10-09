import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  CONTEXTS,
  COUNTER_PREFIX,
  GATE_COUNTER_PREFIX,
  SIGNIN_GATES,
  UNKNOWN_CONTEXT,
  contextParts,
  promptAsGate,
  signupPromptRates,
  summariseGates,
  summariseSignupPrompt,
  vnDay,
  zeroGateTotals,
  type GateTotals,
  type SignupPromptTotals,
} from '../src/lib/signup-prompt'

// ─────────────────────────────────────────────────────────────────────────────
// "JOIN ENO" PROMPT REPORT — the owner's week-one review (2026-10-01: "how many
// pressed x, bounced, and how many signed up"). Reads the anonymous daily totals
// the prompt counts into kv_store (src/lib/signup-prompt-counter.ts), per Vietnam
// day and summed over the window, plus the Profiles created in the same window
// as the ground truth the prompt's own "completed" count is checked against.
//
// ⛔ READ-ONLY. Every query runs inside a READ ONLY transaction, so even a
// mistake here cannot write. Safe on production.
//
// Run:   set -a; . ./.env; set +a; npx tsx scripts/signup-prompt-report.ts
// Flags: --days N        window length in Vietnam days, ending today (default 7)
//        --site S        marketplace | services | all (default marketplace)
//
// Reading it:
//   × rate          dismissed / shown (the × , Esc and the backdrop are one event)
//   bounce after ×  closed it and opened no other page in that tab
//   start rate      (Google + email) / shown
//   completion      signed in within an hour of choosing a method / (Google + email)
//   left open       (UX3 J1) the page was hidden or closed with the prompt still open and unanswered —
//                   once per show; NOT exclusive with × (a visitor can leave, come back and close it)
// Since UX3 J1 (2026-10-05) every total also carries a coarse context class — what kind of browser
// (in-app Facebook / Zalo / other, browser, home-screen app, the eno app) × phone/desktop × vi/en — and
// every sign-in GATE (first save, chat, offer, rental check, save search, post, header/tab bar, the
// /signin page, other) has its own open / Google / email / completed totals. Rows written before the
// deploy carry no class and show as "unknown".
// ⚠️ kv_store is UNLOGGED: a Postgres crash recovery empties it, and the totals
// restart from zero that day. A day that is suddenly all zeros mid-week is that,
// not a dead prompt — compare with the Profiles column.
// ─────────────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const DAY_MS = 24 * 60 * 60 * 1000
const days = Math.max(1, Math.min(90, Number(arg('days') ?? 7) || 7))
const siteArg = (arg('site') ?? 'marketplace').toLowerCase()
if (!['marketplace', 'services', 'all'].includes(siteArg)) {
  console.error(`--site must be marketplace, services or all (got "${siteArg}")`)
  process.exit(2)
}
const site = siteArg === 'all' ? undefined : siteArg

/** The window's Vietnam days, oldest first, ending today. */
const now = Date.now()
const window = Array.from({ length: days }, (_, i) => vnDay(now - (days - 1 - i) * DAY_MS))
/** Midnight in Vietnam (UTC+7) at the start of the first day, and at the end of the last, as UTC instants. */
const vnMidnight = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 60 * 60 * 1000)
const from = vnMidnight(window[0])
const to = new Date(vnMidnight(window[window.length - 1]).getTime() + DAY_MS)

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

const pct = (v: number | null) => (v === null ? '    —' : `${(v * 100).toFixed(1).padStart(5)}%`)
const num = (n: number, w = 7) => String(n).padStart(w)

async function main() {
  const { rows, profiles } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`set transaction read only`
    const rows = await tx.$queryRaw<Array<{ key: string; n: string | null }>>`
      select key, value #>> '{}' as n
        from kv_store
       where (key like ${COUNTER_PREFIX + '%'} or key like ${GATE_COUNTER_PREFIX + '%'})
         and (expires_at is null or expires_at > now())`
    // New Profiles per Vietnam day (all accounts, and those that finished onboarding). Profiles carry
    // no edition, so this column is the same whichever --site is asked for.
    const profiles = await tx.$queryRaw<Array<{ day: string; created: bigint; onboarded: bigint }>>`
      select to_char(("createdAt" at time zone 'UTC') + interval '7 hours', 'YYYY-MM-DD') as day,
             count(*) as created,
             count(*) filter (where "accountType" is not null) as onboarded
        from "Profile"
       where "createdAt" >= ${from} and "createdAt" < ${to}
       group by 1`
    return { rows, profiles }
  })

  const s = summariseSignupPrompt(rows, { site, days: window })
  const g = summariseGates(rows, { site, days: window })
  const prof = new Map(profiles.map((p) => [p.day, { created: Number(p.created), onboarded: Number(p.onboarded) }]))

  console.log(`\n"Join eno" prompt — ${window[0]} → ${window[window.length - 1]} (Vietnam days), site: ${siteArg}`)
  const head = '  day          shown      ×  moved on  left open  google   apple   email  signed in   × rate  bounce  start  complete   new profiles (onboarded)'
  console.log(head)
  console.log('  ' + '─'.repeat(head.length - 2))
  const line = (label: string, t: SignupPromptTotals, p: { created: number; onboarded: number }) => {
    const r = signupPromptRates(t)
    console.log(
      `  ${label.padEnd(10)} ${num(t.shown)} ${num(t.dismissed, 6)} ${num(t.dismissed_then_continued, 9)} ${num(t.left_open, 10)} ${num(t.google_click)} ${num(t.apple_click)} ${num(t.email_click)} ${num(t.signup_completed, 10)}` +
      `   ${pct(r.closeRate)} ${pct(r.bounceAfterClose)} ${pct(r.startRate)} ${pct(r.completionRate)}   ${num(p.created, 8)} (${p.onboarded})`,
    )
  }
  const sumProf = { created: 0, onboarded: 0 }
  for (const d of s.days) {
    const p = prof.get(d.day) ?? { created: 0, onboarded: 0 }
    sumProf.created += p.created
    sumProf.onboarded += p.onboarded
    line(d.day, d.totals, p)
  }
  console.log('  ' + '─'.repeat(head.length - 2))
  line(`${days}-day`, s.total, sumProf)

  const r = signupPromptRates(s.total)
  console.log(`
  × rate           ${pct(r.closeRate)}   closed it (×, Esc or backdrop) / shown
  bounce after ×   ${pct(r.bounceAfterClose)}   closed it and opened no other page in that tab / closed
  left open        ${pct(r.leftOpenRate)}   page hidden or closed with the prompt still open, unanswered / shown
  start rate       ${pct(r.startRate)}   chose Google, Apple or email / shown
  completion       ${pct(r.completionRate)}   signed in within an hour / chose a method
  sign-up per ask  ${pct(r.signupPerShow)}   signed in / shown
  new profiles     ${num(sumProf.created, 5)}    created in the window, any route — ${sumProf.onboarded} finished onboarding, ${Math.max(0, sumProf.created - sumProf.onboarded)} did not (the /onboard loss)
`)

  // ── The prompt by context class (UX3 J1) ──────────────────────────────────────────────────────
  const ctxRows = Object.entries(s.byContext).sort((a, b) => b[1].shown - a[1].shown || a[0].localeCompare(b[0]))
  console.log(`  The prompt by context (${days}-day) — kind of browser · phone/desktop · vi/en`)
  const ch = '  context                        shown      ×  left open  google   apple   email  signed in   start  complete'
  console.log(ch)
  console.log('  ' + '─'.repeat(ch.length - 2))
  if (!ctxRows.length) console.log('  (no prompt events in the window)')
  for (const [ctx, t] of ctxRows) {
    const cr = signupPromptRates(t)
    console.log(`  ${ctx.padEnd(28)} ${num(t.shown)} ${num(t.dismissed, 6)} ${num(t.left_open, 10)} ${num(t.google_click)} ${num(t.apple_click)} ${num(t.email_click)} ${num(t.signup_completed, 10)}   ${pct(cr.startRate)} ${pct(cr.completionRate)}`)
  }
  console.log('  ⚠️ In-app browsers show 0 prompts by design since UX3 J2 (the prompt never opens there on its own).\n')

  // ── Every sign-in gate (UX3 J1) ───────────────────────────────────────────────────────────────
  const gateRows: Array<[string, GateTotals]> = SIGNIN_GATES.map((gate) => [gate, gate === 'timed' ? promptAsGate(s.total) : (g.byGate[gate] ?? zeroGateTotals())])
  console.log(`  Sign-in gates (${days}-day) — where sign-in was asked, what was chosen, what completed`)
  const gh = '  gate           opened  google   apple   email  completed   start  complete  per open'
  console.log(gh)
  console.log('  ' + '─'.repeat(gh.length - 2))
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
  for (const [gate, t] of gateRows) {
    const methods = t.google + t.apple + t.email
    console.log(`  ${gate.padEnd(13)} ${num(t.open)} ${num(t.google)} ${num(t.apple)} ${num(t.email)} ${num(t.completed, 10)}   ${pct(ratio(methods, t.open))} ${pct(ratio(t.completed, methods))} ${pct(ratio(t.completed, t.open))}`)
  }
  console.log(`
  timed = the "Join eno" prompt (its own events above). completed = a sign-in on that device within an hour
  of choosing a method at that gate, counted once; a sign-in after methods at two places can be credited to
  both the prompt and a gate.
`)

  // Completion in-app vs browser — the J2 question — per gate, by kind of browser (device and language summed).
  const byKind = (perCtx: Record<string, GateTotals> | undefined) => {
    const out = new Map<string, GateTotals>()
    for (const [ctx, t] of Object.entries(perCtx ?? {})) {
      const kind = contextParts(ctx)?.context ?? UNKNOWN_CONTEXT
      const acc = out.get(kind) ?? zeroGateTotals()
      for (const k of Object.keys(acc) as Array<keyof GateTotals>) acc[k] += t[k]
      out.set(kind, acc)
    }
    return out
  }
  const promptByKind = new Map<string, GateTotals>()
  for (const [ctx, t] of Object.entries(s.byContext)) {
    const kind = contextParts(ctx)?.context ?? UNKNOWN_CONTEXT
    const acc = promptByKind.get(kind) ?? zeroGateTotals()
    const pg = promptAsGate(t)
    for (const k of Object.keys(acc) as Array<keyof GateTotals>) acc[k] += pg[k]
    promptByKind.set(kind, acc)
  }
  const kinds = [...CONTEXTS, UNKNOWN_CONTEXT]
  console.log(`  Gates by kind of browser (${days}-day): opened → chose a method → completed`)
  const kh = '  gate         ' + kinds.map((k) => k.padStart(18)).join('')
  console.log(kh)
  console.log('  ' + '─'.repeat(kh.length - 2))
  for (const gate of SIGNIN_GATES) {
    const m = gate === 'timed' ? promptByKind : byKind(g.byGateContext[gate])
    if (![...m.values()].some((t) => t.open || t.completed)) continue
    const cells = kinds.map((k) => {
      const t = m.get(k)
      return (t ? `${t.open}→${t.google + t.apple + t.email}→${t.completed}` : '·').padStart(18)
    })
    console.log(`  ${gate.padEnd(12)} ${cells.join('')}`)
  }

  console.log(`
  Notes: counts are anonymous and per tab-event, not per person; "signed in" (a sign-in within an hour of a
  prompt click) includes returning accounts that signed in from the prompt. Everyone, consent or not, is
  counted here; GA sees only visitors who allowed Analytics, so GA's numbers will be lower.
`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
