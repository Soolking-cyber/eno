#!/usr/bin/env node
// ── The voice concierge: flip its runtime switch (kv `concierge:mode`, src/lib/concierge/config.ts) ─────────────────
//
//   set -a; . ./.env; set +a; node scripts/concierge-mode.mjs staff     # the eno team only (ADMIN_EMAILS)
//   node scripts/concierge-mode.mjs all                                   # every signed-in account on eno.vn: the website, and the
//                                                                         #  apps built for the guide (EnoVoice) after their notice
//   node scripts/concierge-mode.mjs off                                   # the kill switch
//   node scripts/concierge-mode.mjs                                       # print the current switch
//
// Writes the ONE kv key and nothing else (no DDL: kv_store already exists). Each server trusts its read for 30 s
// (config.ts MODE_CACHE_MS) and every session start reads it fresh, so 'off' refuses new sessions at once and stops the
// open ones' next turn within 30 s. config.ts reads anything but 'staff' or 'all' as off (fail closed). ⛔ 'all' admits
// every account only once /privacy names the guide's recipients (Soniox, OpenAI, Google) — config.ts VOICE_GUIDE_IN_PRIVACY,
// flipped by that /privacy change; before it, 'all' admits the staff. eno.forum never opens it (config.ts IS_SERVICES), nor
// does an app binary built before the guide reached the apps — no `EnoVoice` in its user agent — whatever this says.
import pg from 'pg'

const [mode] = process.argv.slice(2)
const MODES = ['off', 'staff', 'all']
const KEY = 'concierge:mode' // config.ts MODE_KEY — change both together
if (mode && !MODES.includes(mode)) {
  console.error(`mode must be one of ${MODES.join(' | ')}`)
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
  if (mode) await client.query('SELECT kv_set($1, $2::jsonb, NULL, false)', [KEY, JSON.stringify(mode)])
  const { rows } = await client.query('SELECT kv_get($1) AS v', [KEY])
  const v = rows[0]?.v ?? null
  console.log(`${KEY} = ${v === 'staff' || v === 'all' ? v : v === 'off' ? 'off' : `off (${v === null ? 'unset' : `unknown ${JSON.stringify(v)}`} reads as off)`}`)
} finally {
  await client.end()
}
