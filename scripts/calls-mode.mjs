#!/usr/bin/env node
// ── In-app calls: flip the runtime switch (call_config, scripts/calls-ddl.mjs) ─────────────────────────────────────
//
//   set -a; . ./.env; set +a; node scripts/calls-mode.mjs staff
//   node scripts/calls-mode.mjs beta someone@example.com other@example.com     # the beta cohort, by email
//   node scripts/calls-mode.mjs off                                            # the kill switch
//   node scripts/calls-mode.mjs                                                 # print the current switch
//
// ⛔ Turning calls ON needs the sweep timer running (call_config.swept_at recent), and 'all' is refused until KYC records
// a birth year — both explained in src/lib/calls/server/config.ts. 'off' is always allowed.
// Writes the ONE call_config row and nothing else. 'off' refuses new calls at once (within each server's 30 s cache)
// and ends every live call at its next heartbeat — 15 s — which re-judges it against a fresh read; so does any narrower
// mode, for the calls it no longer admits (src/lib/calls/server/eligibility.ts liveCallRefusal). The minute sweep is
// the backstop for a call nobody is beating. The same switch is PUT /api/admin/calls for an admin session.
// Who each mode admits: src/lib/calls/server/config.ts. Calls still need blocking (ugc-safety) and a relay key.
import pg from 'pg'

const [mode, ...emails] = process.argv.slice(2)
const MODES = ['off', 'staff', 'beta', 'all']
// Restated from src/lib/calls/server/config.ts (a plain .mjs cannot import it) — change both together.
const MODE_ALL_OPEN = false // ⛔ 'all' stays shut until KYC records a birth year (config.ts MODE_ALL_OPEN)
const SWEEP_FRESH_S = 300 // the switch leaves 'off' only while the sweep runs (config.ts SWEEP_FRESH_S)
if (mode && !MODES.includes(mode)) {
  console.error(`mode must be one of ${MODES.join(' | ')}`)
  process.exit(1)
}
if (mode === 'all' && !MODE_ALL_OPEN) {
  console.error("⛔ 'all' stays shut until KYC records a birth year (src/lib/calls/server/config.ts MODE_ALL_OPEN) — use beta")
  process.exit(1)
}
const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL or DATABASE_URL required')
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  if (mode && mode !== 'off') {
    // The sweep must be running before calls go on: it ends a call nobody is beating and replaces its lock-screen ring.
    const { rows } = await client.query(
      `SELECT swept_at > now() - make_interval(secs => $1) AS ok FROM public.call_config WHERE id = 1`, [SWEEP_FRESH_S])
    if (rows[0]?.ok !== true) {
      throw new Error('⛔ the calls sweep has not run in the last 5 minutes — on the box, after the deploy: '
        + 'systemctl enable --now eno-cron-calls-sweep.timer — then run this again')
    }
  }
  if (mode) {
    let cohort = null
    // `beta` with emails REPLACES the cohort with those found; `beta` alone keeps the current cohort.
    if (mode === 'beta' && emails.length) {
      const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
      const found = wanted.length
        ? (await client.query(`SELECT id, lower(email) AS email FROM "Profile" WHERE lower(email) = ANY($1::text[])`, [wanted])).rows
        : []
      const missing = wanted.filter((e) => !found.some((r) => r.email === e))
      if (missing.length) console.warn(`⚠️ no profile for: ${missing.join(', ')} — not added`)
      cohort = found.map((r) => r.id)
    }
    await client.query(
      `INSERT INTO public.call_config (id, mode, cohort, updated_at, updated_by)
       VALUES (1, $1, COALESCE($2::uuid[], '{}'), now(), 'scripts/calls-mode.mjs')
       ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode,
         cohort = CASE WHEN $2::uuid[] IS NULL THEN call_config.cohort ELSE EXCLUDED.cohort END,
         updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [mode, cohort],
    )
  }
  const { rows } = await client.query(`SELECT mode, array_length(cohort, 1) AS cohort, video, relay, updated_at, swept_at FROM public.call_config WHERE id = 1`)
  const r = rows[0]
  console.log(r
    ? `calls: ${r.mode} · cohort ${r.cohort ?? 0} · video ${r.video ? 'on' : 'off'} · relay ${r.relay} · since ${r.updated_at.toISOString()} · last sweep ${r.swept_at ? r.swept_at.toISOString() : 'never'}`
    : 'calls: off (no switch row yet)')
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
