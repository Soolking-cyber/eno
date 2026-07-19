// One-shot Zalo ZNS OTP delivery test — same endpoints/token chain as src/lib/zalo-zns.ts,
// self-contained (raw fetch; reads the rotating token chain from the zalo_oauth_token
// Postgres row like the app — Upstash retired 2026-07-20).
// Usage (after OA verified + template approved + env set):
//   set -a; . ./.env; set +a; node scripts/zns-test.mjs 0901234567
// Development mode (delivers ONLY to app/OA admin numbers, works pre-launch):
//   ZALO_ZNS_MODE=development node scripts/zns-test.mjs 09xxxxxxxx   (with env loaded)
// Sends the literal OTP "123456" — a delivery test, not a real login code.

import pg from 'pg'

const [, , rawPhone] = process.argv
if (!rawPhone) { console.error('usage: node scripts/zns-test.mjs <phone>'); process.exit(1) }

const APP_ID = process.env.ZALO_APP_ID
const APP_SECRET = process.env.ZALO_APP_SECRET
const TEMPLATE_ID = process.env.ZALO_ZNS_TEMPLATE_ID
const INIT_REFRESH = process.env.ZALO_INIT_REFRESH_TOKEN
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL
for (const [k, v] of Object.entries({ ZALO_APP_ID: APP_ID, ZALO_APP_SECRET: APP_SECRET, ZALO_ZNS_TEMPLATE_ID: TEMPLATE_ID, DIRECT_URL: DB_URL })) {
  if (!v) { console.error(`missing env: ${k}`); process.exit(1) }
}

let d = rawPhone.replace(/\D/g, '')
if (d.startsWith('0')) d = '84' + d.slice(1)
else if (!d.startsWith('84')) d = '84' + d

const client = new pg.Client({ connectionString: DB_URL })
await client.connect()

// Token: reuse the app's chain. Refresh tokens are SINGLE-USE, so the
// consume→persist window is serialized against a concurrently-running app via the
// SAME advisory lock the app takes (row FOR UPDATE alone is no gate on an empty
// table — bootstrap is exactly when this script runs).
await client.query('begin')
await client.query(`select pg_advisory_xact_lock(hashtext('zalo:oa-refresh'))`)
const { rows } = await client.query(
  `select access_token, refresh_token, extract(epoch from expires_at) * 1000 as expires_ms
     from zalo_oauth_token where id = 1 for update`)
let state = rows[0]
  ? { accessToken: rows[0].access_token, refreshToken: rows[0].refresh_token, expiresAt: Number(rows[0].expires_ms) }
  : null
if (!state || state.expiresAt <= Date.now()) {
  const seed = state?.refreshToken ?? INIT_REFRESH
  if (!seed) { console.error('no refresh token (set ZALO_INIT_REFRESH_TOKEN)'); await client.query('rollback'); await client.end(); process.exit(1) }
  console.log('refreshing access token…')
  const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: APP_SECRET },
    body: new URLSearchParams({ refresh_token: seed, app_id: APP_ID, grant_type: 'refresh_token' }),
  })
  const json = await res.json()
  if (!json.access_token) { console.error('refresh rejected:', JSON.stringify(json)); await client.query('rollback'); await client.end(); process.exit(1) }
  state = { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (Number(json.expires_in || 90000) - 3600) * 1000 }
  await client.query(
    `insert into zalo_oauth_token (id, access_token, refresh_token, expires_at, updated_at)
     values (1, $1, $2, to_timestamp($3 / 1000.0), now())
     on conflict (id) do update set access_token = excluded.access_token,
       refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, updated_at = now()`,
    [state.accessToken, state.refreshToken, state.expiresAt])
  console.log('✓ token refreshed + chain persisted to Postgres')
}
await client.query('commit')
await client.end()

console.log(`sending test OTP to ${d}${process.env.ZALO_ZNS_MODE === 'development' ? ' (development mode)' : ''}…`)
const send = await fetch('https://business.openapi.zalo.me/message/template', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', access_token: state.accessToken },
  body: JSON.stringify({
    phone: d,
    template_id: TEMPLATE_ID,
    template_data: { otp: '123456' },
    tracking_id: `zns-test-${Date.now()}`,
    ...(process.env.ZALO_ZNS_MODE === 'development' ? { mode: 'development' } : {}),
  }),
})
const out = await send.json()
console.log(JSON.stringify(out, null, 2))
if (out.error === 0) console.log('\n✓ ZNS accepted — check the Zalo app on that phone.')
else if (out.error === -118) console.log('\n✗ that number has no Zalo account (-118) — the app would fall back to SMS.')
else if (out.error === -135) console.log('\n✗ OA not business-verified yet (-135).')
else if (out.error === -124) console.log('\n✗ token invalid (-124) — chain may need re-authorization via API Explorer.')
else console.log('\n✗ rejected — see error table: developers.zalo.me/docs/zbs-template-message/bang-ma-loi')
