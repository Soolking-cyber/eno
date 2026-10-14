import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { LICENCE_SWEEP_DESK_UNRESOLVED, LICENCE_SWEEP_MAX_PULL, sweepLicenceHolds } from '@/lib/core/licence-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Each pull is one transaction + one audit append. Rows that never carried a stamp are not capped (core/licence-check.ts),
// so a first night is bounded by how many unchecked aisle rows exist — measured 2026-10-14: none live but VietKite's 14
// (grandfathered) and Hoàng Phi's one hidden row. eno-cron.sh allows 900s.
export const maxDuration = 300

/** The ceiling ?max= may raise the mass-pull refusal to — a run that would pull more is a bug to look at, not a night's work. */
const MAX_PULL_CEILING = 500

// ── THE LICENCE CHECK'S DAILY BACKSTOP (owner, 2026-10-14) ──────────────────────────────────────────────────────────
//
// An e-Visa or Legal & permits listing from anyone but eno's own desk is public only once an admin has approved its
// provider's registered name and licence number (src/lib/licence-stamp.ts). Every publish path checks that before it
// writes; this sweep is what catches anything that got past them anyway — a write through a path nobody guarded, a
// raw-SQL repair, two edits racing an approval — and unpublishes it (src/lib/core/licence-check.ts sweepLicenceHolds:
// verified rows in either aisle, in ANY status, that are neither the desk's, nor cleared, nor grandfathered).
//
// ⏰ 17:05 UTC = 00:05 ICT, daily (infra/vn-node/cron/install-cron-timers.sh). Five minutes after midnight in Vietnam on
// purpose: VietKite's grandfather (LICENCE_GRANDFATHER — its e-Visa rows stay live without a checked licence) ends at
// 00:00 ICT on the /prohibited in-force date, so the first run after it is this one, and any VietKite row not yet
// approved goes down then. Before that date the sweep honours the grandfather only while its seller id still names
// VietKite's storefront (R7): otherwise it refuses, writing nothing.
//
// ⚠️ ONE EDITION IS ENOUGH: both apps share the one database and the ISR invalidation table, so a run on eno.vn
// unpublishes for both and purges both (the timer is pinned to eno.vn:3001 whatever host the installer is run for).
//
// `?dryRun=1` writes nothing and says what a run would pull now — the deploy-day check before the first real run.
// `?max=N` (1..500) raises the mass-pull refusal for one deliberate run; the timer never passes it.
//
// Response — eno-cron.sh marks any non-200 FAILED, so every refusal is a 500 and the unit shows red:
//   · 200 `{ ok: true, checked, deskExempt, grandfathered, grandfatherUntil, pulled, pulledIds }` (+ `dryRun: true`);
//   · 500 `{ ok: false, error: 'desk_unresolved' }` — eno's desk did not resolve (HIDDEN_DESK_OWNER_EMAILS), and with
//     no desk ids eno's own e-Visa rows would read as anyone's and be pulled;
//   · 500 `{ ok: false, error: 'grandfather_unresolved', grandfatherProblem, wouldPull, … }` — inside the window, the
//     grandfather's id, handle and owner no longer name one storefront (a restore that changed ids). Read
//     grandfatherProblem first: it says which fact failed, and never carries another account's email.
//     ⚠️ A REFUSAL IS NOT "NOTHING WRITTEN": the rows of the storefronts those facts name stay live (`wouldPull`), and
//     every OTHER unchecked row WAS pulled (`pulled`, `pulledIds`) — one broken identity never suspends other takedowns;
//   · 500 `{ ok: false, refused: 'mass_pull', wouldPull, maxPull, … }` — more than maxPull rows whose STAMP no longer
//     matches: a broken stamp recipe must not empty both aisles overnight, so THOSE stay live (wouldPull). Rows that never
//     carried a stamp were still pulled (`pulled`) — the cap never keeps an unchecked listing public. Look at the list
//     (?dryRun=1), then re-run with ?max=N if it is right;
//   · 400 `{ ok: false, error: 'bad_request' }` — a ?max= that is not a whole number from 1 to 500.
// The first 200 bytes reach the journal (eno-cron.sh), so the counts and the reason come first. Auth failures are
// route()'s 401.
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  const params = new URL(req.url).searchParams
  // Fails SAFE (commit gate, 2026-10-14): any dryRun value but an explicit 0 / false / no is a dry run — a typo such as
  // ?dryRun=true or ?dryrun=1 must never turn the deploy-day check into a real pull.
  const dryKey = [...params.keys()].find((k) => /^dry[_-]?run$/i.test(k))
  const dryParam = dryKey === undefined ? null : params.get(dryKey)
  const dryRun = dryParam !== null && !/^(0|false|no)$/i.test(dryParam.trim())
  let maxPull = LICENCE_SWEEP_MAX_PULL
  const max = params.get('max')
  if (max !== null) {
    const n = Number(max)
    if (!Number.isInteger(n) || n < 1 || n > MAX_PULL_CEILING) return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 })
    maxPull = n
  }
  let r: Awaited<ReturnType<typeof sweepLicenceHolds>>
  try {
    r = await sweepLicenceHolds({ dryRun, maxPull })
  } catch (e) {
    if (e instanceof Error && e.message === LICENCE_SWEEP_DESK_UNRESOLVED) return NextResponse.json({ ok: false, error: 'desk_unresolved' }, { status: 500 })
    throw e
  }
  if (r.refused === 'grandfather_unresolved') {
    return NextResponse.json({ ok: false, error: 'grandfather_unresolved', grandfatherProblem: r.grandfatherProblem, wouldPull: r.wouldPull, ...r }, { status: 500 })
  }
  if (r.refused === 'mass_pull') return NextResponse.json({ ok: false, refused: r.refused, wouldPull: r.wouldPull, maxPull, ...r }, { status: 500 })
  return { ok: true, ...r }
})
