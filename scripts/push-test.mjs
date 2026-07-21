#!/usr/bin/env node
/**
 * Native push + app-icon badge diagnostic.
 *
 * Native push (and therefore the badge) is dormant until APNs/FCM credentials exist, and the
 * failure modes are all SILENT: a wrong host, a stale key, a bundle-id typo and a sandbox/
 * production mismatch every look identical from the app — nothing arrives, no error surfaces.
 * This tells you which one you have.
 *
 *   node scripts/push-test.mjs                 # config check only, sends nothing
 *   node scripts/push-test.mjs --send <email>  # also send a real test push + badge
 *
 * Run it with the env loaded:  set -a; . ./.env; set +a; node scripts/push-test.mjs
 */
import crypto from 'node:crypto'
import http2 from 'node:http2'
import pg from 'pg'

const b64url = (i) => Buffer.from(i).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
// Mirrors src/lib/native-push.ts: a .p8 is multi-line PEM and is NOT sh-safe in a dotenv
// value, so it is stored base64-encoded and decoded here.
const decodeMaybeB64 = (s) => (s.trim().startsWith('{') || s.includes('BEGIN') ? s : Buffer.from(s.trim(), 'base64').toString('utf8'))

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`)

function checkApns() {
  console.log('\nAPNs (iOS — this is what drives the app-icon badge)')
  const keyId = process.env.APNS_KEY_ID?.trim()
  const teamId = process.env.APNS_TEAM_ID?.trim()
  const key = process.env.APNS_KEY?.trim()
  const bundleId = process.env.APNS_BUNDLE_ID?.trim()
  const missing = [['APNS_KEY_ID', keyId], ['APNS_TEAM_ID', teamId], ['APNS_KEY', key], ['APNS_BUNDLE_ID', bundleId]]
    .filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) {
    bad(`not configured — missing ${missing.join(', ')}`)
    console.log('    → docs/apns-setup.md walks through generating the key.')
    return null
  }
  ok(`key ${keyId} · team ${teamId} · bundle ${bundleId}`)

  const pem = decodeMaybeB64(key)
  if (!pem.includes('BEGIN PRIVATE KEY')) {
    bad('APNS_KEY does not decode to a PEM private key — re-check the base64 of the .p8')
    return null
  }
  try {
    crypto.createSign('SHA256').update('probe').sign({ key: pem, dsaEncoding: 'ieee-p1363' })
    ok('private key parses and signs (ES256)')
  } catch (e) {
    bad(`private key will not sign: ${e.message}`)
    return null
  }

  const production = process.env.APNS_PRODUCTION === 'true'
  const host = production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
  ok(`host ${host}`)
  // The single most common silent failure: the host must match how the BUILD was signed.
  warn(production
    ? 'APNS_PRODUCTION=true → tokens from a DEV/debug build will be rejected as BadDeviceToken.'
    : 'APNS_PRODUCTION is not "true" → SANDBOX. TestFlight and App Store builds will be rejected. Set it to true for any distributed build.')

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const claim = b64url(JSON.stringify({ iss: teamId, iat: now }))
  const sig = b64url(crypto.createSign('SHA256').update(`${header}.${claim}`).sign({ key: pem, dsaEncoding: 'ieee-p1363' }))
  ok('auth JWT built')
  return { host, bundleId, jwt: `${header}.${claim}.${sig}` }
}

function checkFcm() {
  console.log('\nFCM (Android — badge is launcher-dependent, best-effort)')
  const projectId = process.env.FCM_PROJECT_ID?.trim()
  const raw = process.env.FCM_CREDENTIALS?.trim()
  if (!projectId || !raw) { bad('not configured — missing FCM_PROJECT_ID and/or FCM_CREDENTIALS'); return }
  try {
    const sa = JSON.parse(decodeMaybeB64(raw))
    if (!sa.client_email || !sa.private_key) throw new Error('missing client_email/private_key')
    ok(`project ${projectId} · service account ${sa.client_email}`)
  } catch (e) {
    bad(`FCM_CREDENTIALS is not valid service-account JSON: ${e.message}`)
  }
}

function sendApns(cfg, token, payload) {
  return new Promise((resolve) => {
    const client = http2.connect(cfg.host)
    client.on('error', (e) => { try { client.close() } catch {} ; resolve({ status: 0, reason: e.message }) })
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${token}`,
      authorization: `bearer ${cfg.jwt}`, 'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert', 'content-type': 'application/json',
    })
    let status = 0, data = ''
    req.on('response', (h) => { status = Number(h[':status']) || 0 })
    req.setEncoding('utf8'); req.on('data', (d) => { data += d })
    req.on('end', () => {
      try { client.close() } catch {}
      let reason = ''
      try { reason = JSON.parse(data).reason || '' } catch {}
      resolve({ status, reason })
    })
    req.on('error', (e) => { try { client.close() } catch {} ; resolve({ status: 0, reason: e.message }) })
    req.end(JSON.stringify(payload))
  })
}

async function main() {
  console.log('eno — native push / app-icon badge diagnostic')
  const apns = checkApns()
  checkFcm()

  const sendIdx = process.argv.indexOf('--send')
  if (sendIdx === -1) {
    console.log('\nConfig check only. Add `--send <email>` to deliver a real test push + badge.\n')
    return
  }
  const email = process.argv[sendIdx + 1]
  if (!email) { console.error('\n--send needs an account email\n'); process.exit(1) }
  if (!apns) { console.error('\nCannot send: APNs is not configured.\n'); process.exit(1) }

  // Raw pg, per the repo's .mjs script convention — Prisma 7's generator emits TypeScript
  // only, so there is no runtime client to import from a plain .mjs file.
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await client.connect()
  try {
    const prof = await client.query('select id from "Profile" where email = $1 limit 1', [email])
    if (!prof.rows.length) { console.error(`\nNo account for ${email}\n`); process.exit(1) }
    const profileId = prof.rows[0].id

    const tok = await client.query(`select token from "NativePushToken" where "profileId" = $1 and platform = 'ios'`, [profileId])
    const tokens = tok.rows
    console.log(`\nRegistered iOS devices for ${email}: ${tokens.length}`)
    if (!tokens.length) {
      warn('none — open the app once (signed in) so it registers, then re-run.')
      return
    }

    // The badge number the app icon should end up showing — the same two halves
    // src/lib/unread.ts computes, so this diagnostic cannot disagree with the server.
    const { rows: [counts] } = await client.query(`
      select
        (select count(*) from "Notification" where "recipientId" = $1 and read = false)::int as notifs,
        (select coalesce(sum("buyerUnread"), 0) from "Conversation" where "buyerProfileId" = $1)::int as as_buyer,
        (select coalesce(sum("sellerUnread"), 0) from "Conversation" where "sellerProfileId" = $1)::int as as_seller
    `, [profileId])
    const badge = counts.notifs + counts.as_buyer + counts.as_seller
    console.log(`Current unread total (what the badge should show): ${badge}  (${counts.notifs} notifications + ${counts.as_buyer + counts.as_seller} messages)`)

    for (const t of tokens) {
      const r = await sendApns(apns, t.token, {
        aps: { alert: { title: 'eno', body: 'Push test — your app icon badge should update.' }, sound: 'default', badge },
      })
      const tail = t.token.slice(-8)
      if (r.status === 200) ok(`…${tail} delivered (badge ${badge})`)
      else if (r.reason === 'BadDeviceToken') bad(`…${tail} BadDeviceToken — SANDBOX/PRODUCTION mismatch (APNS_PRODUCTION) or wrong bundle id`)
      else if (r.reason === 'Unregistered') bad(`…${tail} Unregistered — app deleted; the server prunes these on the next real send`)
      else if (r.reason === 'InvalidProviderToken') bad(`…${tail} InvalidProviderToken — key/team id mismatch, or the key was revoked`)
      else if (r.reason === 'TopicDisallowed') bad(`…${tail} TopicDisallowed — APNS_BUNDLE_ID is not this key's app`)
      else bad(`…${tail} HTTP ${r.status} ${r.reason}`)
    }
  } finally {
    await client.end()
  }
  console.log('')
}

main().catch((e) => { console.error(e); process.exit(1) })
