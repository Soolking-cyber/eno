// One-shot Zalo ZNS OTP delivery test — same endpoints/token chain as src/lib/zalo-zns.ts,
// self-contained (raw fetch, reads the rotating token chain from Upstash like the app).
// Usage (after OA verified + template approved + env set):
//   set -a; . ./.env; set +a; node scripts/zns-test.mjs 0901234567
// Development mode (delivers ONLY to app/OA admin numbers, works pre-launch):
//   ZALO_ZNS_MODE=development node scripts/zns-test.mjs 09xxxxxxxx   (with env loaded)
// Sends the literal OTP "123456" — a delivery test, not a real login code.

const [, , rawPhone] = process.argv
if (!rawPhone) { console.error('usage: node scripts/zns-test.mjs <phone>'); process.exit(1) }

const APP_ID = process.env.ZALO_APP_ID
const APP_SECRET = process.env.ZALO_APP_SECRET
const TEMPLATE_ID = process.env.ZALO_ZNS_TEMPLATE_ID
const INIT_REFRESH = process.env.ZALO_INIT_REFRESH_TOKEN
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
for (const [k, v] of Object.entries({ ZALO_APP_ID: APP_ID, ZALO_APP_SECRET: APP_SECRET, ZALO_ZNS_TEMPLATE_ID: TEMPLATE_ID, UPSTASH_REDIS_REST_URL: REDIS_URL })) {
  if (!v) { console.error(`missing env: ${k}`); process.exit(1) }
}

let d = rawPhone.replace(/\D/g, '')
if (d.startsWith('0')) d = '84' + d.slice(1)
else if (!d.startsWith('84')) d = '84' + d

const rget = async (key) =>
  (await (await fetch(`${REDIS_URL}/get/${key}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } })).json()).result
const rset = async (key, val) =>
  fetch(`${REDIS_URL}/set/${key}`, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` }, body: JSON.stringify(val) })

// Token: reuse the app's chain from Redis; refresh if stale (persisting the NEW pair —
// refresh tokens are SINGLE-USE); bootstrap from ZALO_INIT_REFRESH_TOKEN if empty.
let state = null
try { const rawState = await rget('zalo:oa-tokens'); state = rawState ? JSON.parse(rawState) : null } catch {}
if (!state || state.expiresAt <= Date.now()) {
  const seed = state?.refreshToken ?? INIT_REFRESH
  if (!seed) { console.error('no refresh token (set ZALO_INIT_REFRESH_TOKEN)'); process.exit(1) }
  console.log('refreshing access token…')
  const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: APP_SECRET },
    body: new URLSearchParams({ refresh_token: seed, app_id: APP_ID, grant_type: 'refresh_token' }),
  })
  const json = await res.json()
  if (!json.access_token) { console.error('refresh rejected:', JSON.stringify(json)); process.exit(1) }
  state = { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (Number(json.expires_in || 90000) - 3600) * 1000 }
  await rset('zalo:oa-tokens', state)
  console.log('✓ token refreshed + chain persisted to Upstash')
}

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
