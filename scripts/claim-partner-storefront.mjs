/**
 * GIVE AN EXISTING ACCESSTRADE STOREFRONT AN ENO-RUN LOGIN (owner 2026-11-14: "turn on accesstrade 2nd hand listings and
 * partners also give their login passwords"; asked, with the trade-offs, the owner chose "Partners now, admins sell").
 *
 *   node --env-file=.env scripts/claim-partner-storefront.mjs cellphones            # dry run (reads only)
 *   node --env-file=.env scripts/claim-partner-storefront.mjs cellphones --apply --email-forwards
 *   node --env-file=.env scripts/claim-partner-storefront.mjs cellphones --reverse [--apply]
 *
 * CellphoneS and Điện Thoại Vui are AccessTrade storefronts with NO owner. This creates an eno-held business account for
 * one of them and makes it the storefront's owner, so eno's admins can sign in, answer its chats and take orders. Unlike
 * scripts/register-partner-seller.mjs it creates no Seller (the storefront exists, with its listings) and no Handle (the
 * strip and the inbox name these two by seller id — a handle can be freed and re-claimed; plan review, codex + opus).
 *
 * ⛔ ONLY THE TWO STOREFRONTS BELOW, BY SELLER ID, AND ONLY WHILE STILL OWNERLESS: the UPDATE re-states `"ownerId" IS NULL`
 * and must change exactly one row, inside the same transaction as the Profile — a storefront someone claimed first is
 * refused, never adopted.
 * ⛔ THE PASSWORD IS GENERATED HERE AND WRITTEN ONLY TO ~/eno-vault/<shop>-partner-password.txt (dir 0700, file 0600,
 * created exclusively). It is never printed, logged or passed on a command line (the 2026-11-09 lesson: a fill-in
 * placeholder became a real password). Read it with `cat` yourself.
 * ⛔ IT ALSO SETS `officialPartner = true` — the second write path for that flag (the first is set-official-partner.mjs),
 * in the same transaction, so a storefront is never owned-but-not-partner. The prior value is journaled and printed by --reverse.
 * ⚠️ THE ENO-RUN POWERS (chat on these affiliate rows, the nightly datafeed on an owned shop, the inbox count) need the
 * printed (sellerId, ownerProfileId) PAIR PINNED in src/lib/eno-run-partners.ts and deployed. Until then the deployed code
 * treats the shop as owned by a person: the nightly job, the importer and the sweeps leave it alone.
 * ⚠️ The login email must reach eno: a Cloudflare Email Routing rule <email> → support@eno.forum on the eno.vn zone (the
 * catch-all drops), added BEFORE --apply, or a password reset goes nowhere.
 *
 * ⛔ RECOVERY READS THE DATABASE, NOT THIS SCRIPT'S PROGRESS (commit gate, codex + opus): the claim record (auth user id,
 * prior flag) is on disk BEFORE the transaction, and --reverse decides from the live Seller row what happened —
 *   · owned by the login this run recorded from its own createUser → detach (one transaction) and ban it;
 *   · a recorded login that does not own it → ban it;  · no recorded login → report only, a person decides.
 * ⛔ The script never deletes a login, and never acts on a login it did not record.
 * A COMMIT whose answer is lost is settled the same way (a fresh connection reads the row) before anything is deleted.
 * The Profile is kept after a committed claim: it may hold customer chats. A ban that fails is recorded and retried by
 * the next --reverse.
 */
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SHOPS = {
  cellphones: { sellerId: 'cmt78nvif0000gpq48kvzmxjw', name: 'CellphoneS', email: 'cellphones@eno.vn' },
  dienthoaivui: { sellerId: 'cmtr9qva90000glq44fkjs18b', name: 'Điện Thoại Vui', email: 'dienthoaivui@eno.vn' },
}

const key = process.argv[2]
const APPLY = process.argv.includes('--apply')
const REVERSE = process.argv.includes('--reverse')
const SHOP = SHOPS[key] && { ...SHOPS[key] }
// A re-claim after a --reverse needs a FRESH login (the reversed one stays banned): --email <another eno-controlled address>.
const emailArg = process.argv[process.argv.indexOf('--email') + 1]
if (SHOP && process.argv.includes('--email')) {
  if (!emailArg || emailArg.startsWith('--') || !/@eno\.vn$/i.test(emailArg)) { console.error('--email takes an @eno.vn address (one that forwards to eno)'); process.exit(1) }
  SHOP.email = emailArg
}
if (!SHOP) {
  console.error(`Usage: node --env-file=.env scripts/claim-partner-storefront.mjs <${Object.keys(SHOPS).join('|')}> [--apply] [--reverse]`)
  process.exit(1)
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const DB = process.env.DIRECT_URL
if (!URL_ || !SECRET || !DB) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL — run with node --env-file=.env'); process.exit(1) }

const VAULT = join(homedir(), 'eno-vault')
const PW_FILE = join(VAULT, `${key}-partner-password.txt`)
const CLAIM_FILE = join(VAULT, `${key}-partner-claim.json`)
// ONE lock for the script, not per shop: two shops given the same --email must not race either (codex, commit gate).
const LOCK_FILE = join(VAULT, 'claim-partner-storefront.lock')

/** One claim or reverse at a time (codex, commit gate): a reverse never runs beside an in-flight claim. */
function takeLock() {
  mkdirSync(VAULT, { recursive: true, mode: 0o700 })
  try { closeSync(openSync(LOCK_FILE, 'wx', 0o600)) } catch (e) {
    if (e.code === 'EEXIST') { console.error(`${LOCK_FILE} exists — another claim/reverse is running, or one died: check, then remove it`); process.exit(1) }
    throw e
  }
  process.on('exit', () => { try { unlinkSync(LOCK_FILE) } catch { /* gone */ } })
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))
}


/** Replace the claim record in place (tmp unique to this process, then rename — never a half-written record). */
function saveRecord(record) {
  const tmp = `${CLAIM_FILE}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w', 0o600)
  try { writeSync(fd, JSON.stringify(record, null, 1) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, CLAIM_FILE)
}

/** Who owns the storefront NOW, read on a fresh connection (the main one may be the one that failed). */
async function ownerNow(sellerId) {
  const f = new Client({ connectionString: DB })
  await f.connect()
  try { return (await f.query(`select "ownerId" from "Seller" where id = $1`, [sellerId])).rows[0]?.ownerId ?? null } finally { await f.end() }
}

const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } })
const c = new Client({ connectionString: DB })

/** Page through every auth user — the first page alone stops finding anyone once the table outgrows it. */
async function findAuthUser(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (data.users.length < 200) return null
  }
}

/** Write a file that must not exist yet, 0600, fsynced (the vault dir is made 0700 if it is new). */
function writeNew(path, text) {
  mkdirSync(VAULT, { recursive: true, mode: 0o700 })
  const fd = openSync(path, 'wx', 0o600)
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
}

async function banLogin(profileId) {
  const b = await admin.auth.admin.updateUserById(profileId, { ban_duration: '876000h' })
  if (b.error) throw new Error(`could NOT ban login ${profileId} (${b.error.message}) — re-run --reverse --apply to retry`)
}

async function claim() {
  const s = (await c.query(`select id, name, "ownerId", "officialPartner" from "Seller" where id = $1`, [SHOP.sellerId])).rows[0]
  if (!s) throw new Error(`no Seller ${SHOP.sellerId}`)
  if (s.name !== SHOP.name) throw new Error(`Seller ${s.id} is "${s.name}", expected "${SHOP.name}" — refusing`)
  if (s.ownerId) throw new Error(`${SHOP.name} already has an owner (${s.ownerId}) — refusing; this script never adopts a claimed storefront`)
  if (existsSync(PW_FILE) || existsSync(CLAIM_FILE)) throw new Error(`${PW_FILE} or ${CLAIM_FILE} exists — an earlier run: run --reverse (dry run) first, it says what landed`)
  const profile = (await c.query(`select id from "Profile" where lower(email) = lower($1)`, [SHOP.email])).rows[0]
  if (profile) throw new Error(`a Profile already uses ${SHOP.email} (${profile.id}) — refusing`)
  if (await findAuthUser(SHOP.email)) throw new Error(`an auth user already exists for ${SHOP.email} — refusing. With no ${CLAIM_FILE} it owns nothing: delete it in Supabase, then re-run`)

  console.log(`${SHOP.name} (${s.id})`)
  console.log(`  owner now        : none`)
  console.log(`  officialPartner  : ${s.officialPartner} -> true`)
  console.log(`  new login        : ${SHOP.email} (business, eno-held; password generated into ${PW_FILE}, never printed)`)
  console.log(`  ⚠️ the email must forward to eno (Cloudflare Email Routing rule ${SHOP.email} → support@eno.forum) before --apply`)
  console.log(`  ⚠️ FROM --apply UNTIL THE DEPLOY THAT PINS THE PAIR, the deployed code treats this shop as a person's: no nightly`)
  console.log(`     reprice/restock, no import, no sweeps (opus, commit gate). Run it right before that deploy, never days ahead.`)
  // The write statements PLANNED against the live schema before a login exists (opus, commit gate). ⚠️ EXPLAIN catches a
  // wrong column, type or value — not NOT NULL, CHECK, unique or FK failures, which only a real write meets. The Profile
  // insert is the one scripts/register-partner-seller.mjs has run in production for every partner since 2026-08.
  const probe = '00000000-0000-0000-0000-000000000000'
  await c.query(`explain insert into "Profile" (id, email, "displayName", "accountType", "dailyReminderOptIn", "updatedAt") values ($1::uuid, $2, $3, 'business', false, now())`, [probe, SHOP.email, SHOP.name])
  await c.query(`explain update "Seller" set "ownerId" = $1::uuid, "claimedAt" = now(), "officialPartner" = true where id = $2 and "ownerId" is null`, [probe, SHOP.sellerId])
  console.log('  write statements : plan against the live schema ✓')
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply --email-forwards (once the forwarding rule exists).'); return }
  // The login must be reachable before it owns anything (opus, commit gate): the operator says the rule exists.
  if (!process.argv.includes('--email-forwards')) throw new Error(`add the Cloudflare Email Routing rule ${SHOP.email} → support@eno.forum first, then re-run with --apply --email-forwards`)

  // 0. Intent on disk before anything: --reverse can always find what this run started (codex, commit gate).
  const record = { status: 'creating', sellerId: SHOP.sellerId, name: SHOP.name, email: SHOP.email, priorOfficialPartner: s.officialPartner, startedAt: new Date().toISOString() }
  writeNew(CLAIM_FILE, JSON.stringify(record, null, 1) + '\n')
  // 1. The password, before anything uses it.
  writeNew(PW_FILE, randomBytes(18).toString('base64url') + '\n')
  const password = readFileSync(PW_FILE, 'utf8').trim()

  // 2. The auth user. A failed call may still have created it (a lost answer): look it up by the fixed email.
  const created = await admin.auth.admin.createUser({ email: SHOP.email, password, email_confirm: true })
  let userId = created.data?.user?.id
  if (created.error) {
    // ⛔ Nothing is deleted on a failed create: the answer may have been lost and the login may appear later. The record
    // stays ('creating'); --reverse then reports what it sees and leaves the call to a person.
    throw new Error(`createUser reported "${created.error.message}" — stopped, nothing owned. Run --reverse (dry run): it reports any login for ${SHOP.email}.`)
  }
  saveRecord({ ...record, status: 'pending', ownerProfileId: userId })
  console.log(`auth user created: ${userId}. If this run stops before "Done", run --reverse --apply: it reads the storefront and undoes whatever landed.`)

  // 3. Profile + owner + partner flag, one transaction, the ownerless check re-stated in the write.
  let committed = false
  let priorFlag = s.officialPartner
  try {
    await c.query('BEGIN')
    // updatedAt has no DB default (Prisma sets it client-side). A Profile may already exist for a fresh auth user (a
    // sign-up trigger): the upsert makes it business either way. No daily reminder for a shop of a thousand rows.
    await c.query(
      `insert into "Profile" (id, email, "displayName", "accountType", "dailyReminderOptIn", "updatedAt")
       values ($1::uuid, $2, $3, 'business', false, now())
       on conflict (id) do update set "accountType" = 'business', "displayName" = excluded."displayName", "dailyReminderOptIn" = false, "updatedAt" = now()`,
      [userId, SHOP.email, SHOP.name],
    )
    // The flag's prior value is read in THIS transaction, under the row lock (codex, commit gate) — not the preflight's copy.
    const locked = (await c.query(`select "officialPartner" from "Seller" where id = $1 and "ownerId" is null for update`, [SHOP.sellerId])).rows[0]
    if (!locked) throw new Error('the storefront was claimed by someone else meanwhile — nothing kept')
    priorFlag = locked.officialPartner
    const u = await c.query(
      `update "Seller" set "ownerId" = $1::uuid, "claimedAt" = now(), "officialPartner" = true where id = $2 and "ownerId" is null`,
      [userId, SHOP.sellerId],
    )
    if (u.rowCount !== 1) throw new Error(`the storefront was claimed by someone else meanwhile (${u.rowCount} rows) — nothing kept`)
    // The locked prior value reaches the record BEFORE the commit (codex, commit gate): a crash after it cannot leave
    // --reverse with the preflight's stale copy.
    saveRecord({ ...record, status: 'pending', ownerProfileId: userId, priorOfficialPartner: priorFlag })
    await c.query('COMMIT')
    committed = true
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    // ⛔ A COMMIT whose answer was lost may have landed: read the row before removing anything (codex, commit gate).
    const owner = await ownerNow(SHOP.sellerId).catch(() => undefined)
    if (owner === userId) committed = true
    else {
      console.error(`⚠️ the claim did not land (${e.message}). Run --reverse --apply: it bans the unused login and archives the files.`)
      throw e
    }
  }
  if (!committed) throw new Error('unreachable')

  saveRecord({ ...record, status: 'claimed', ownerProfileId: userId, priorOfficialPartner: priorFlag, claimedAt: new Date().toISOString() })
  console.log(`\nDone. ${SHOP.name} is owned by ${SHOP.email}; officialPartner = true.`)
  console.log(`  password: ${PW_FILE}   (read it with: cat ${PW_FILE})`)
  console.log(`  PIN THIS PAIR in src/lib/eno-run-partners.ts: { sellerId: '${SHOP.sellerId}', ownerProfileId: '${userId}' }`)
  console.log(`  pages: the badge shows after a Cloudflare tag purge (eno-html, eno-public) on both zones; PDPs refresh on their ISR window`)
  console.log(`  way back: node --env-file=.env scripts/claim-partner-storefront.mjs ${key} --reverse --apply`)
}

/**
 * --reverse acts ONLY on what this script recorded itself — the login id returned by its OWN successful createUser
 * (commit gate rounds 1–6: every automatic guess at an ambiguous login — by email, by time, after a lost answer — found a
 * new way to hit the wrong account). ⛔ It never deletes a login.
 *   · the shop is owned by the recorded login  → record 'reversing', detach (one transaction), ban, archive;
 *   · a recorded login that does not own it    → ban it (it is this run's, and owns nothing of ours now), archive;
 *   · no recorded login                        → REPORT what is there (any login for the email, when it was created, the
 *                                                shop's owner) and write nothing: a person settles it in Supabase.
 * A ban that fails keeps the record; the next --reverse retries. The password file is archived with the record.
 * officialPartner is never changed by --reverse: its prior value is printed with the set-official-partner.mjs command.
 */
async function reverse() {
  if (!existsSync(CLAIM_FILE)) throw new Error(`${CLAIM_FILE} not found — nothing this script started for ${SHOP.name}`)
  const r = JSON.parse(readFileSync(CLAIM_FILE, 'utf8'))
  const s = (await c.query(`select id, "ownerId", "officialPartner" from "Seller" where id = $1`, [r.sellerId])).rows[0]
  if (!s) throw new Error(`no Seller ${r.sellerId}`)
  const archive = (tag) => {
    const stamp = Date.now()
    if (existsSync(PW_FILE)) renameSync(PW_FILE, `${PW_FILE}.${tag}-${stamp}`)
    renameSync(CLAIM_FILE, `${CLAIM_FILE}.${tag}-${stamp}`)
  }
  const dry = () => { console.log('\nDRY RUN — nothing written. Re-run with --reverse --apply.') }
  // A Profile a sign-up trigger made for this email survives a rolled-back claim (opus, commit gate): reported, never deleted.
  const leftover = (await c.query(`select p.id, exists (select 1 from "Seller" x where x."ownerId" = p.id) as owns from "Profile" p where lower(p.email) = lower($1)`, [r.email])).rows[0]
  if (leftover && !leftover.owns && leftover.id !== s.ownerId) console.log(`note: a Profile for ${r.email} exists (${leftover.id}) and owns no storefront — a re-claim of this email is refused while it stays; use --email <another @eno.vn address>`)

  if (r.ownerProfileId && s.ownerId === r.ownerProfileId) {
    console.log(`${r.name}: owned by this script's login ${r.ownerProfileId} → detach and ban the login (officialPartner left at ${s.officialPartner})`)
    if (!APPLY) return dry()
    saveRecord({ ...r, status: 'reversing' })
    await c.query('BEGIN')
    // ⛔ officialPartner is NOT touched (codex, commit gate rounds 6–8): no check can tell this claim's write from a later
    // deliberate decision that set the same value. It is printed with the command to restore it — a person's call.
    const u = await c.query(
      `update "Seller" set "ownerId" = null, "claimedAt" = null where id = $1 and "ownerId" = $2::uuid`,
      [r.sellerId, r.ownerProfileId],
    )
    if (u.rowCount !== 1) { await c.query('ROLLBACK'); throw new Error(`changed ${u.rowCount} rows — rolled back`) }
    await c.query('COMMIT')
    saveRecord({ ...r, status: 'detached-ban-pending' })
    await banLogin(r.ownerProfileId)
    archive('reversed')
    console.log(`\nDetached and banned. ${r.name} is ownerless again. Unpin the pair in src/lib/eno-run-partners.ts and deploy; purge the edge tags.`)
    if (r.priorOfficialPartner === false) console.log(`officialPartner was false before the claim and is left true: node --env-file=.env scripts/set-official-partner.mjs ${r.sellerId} --off --apply if it should go back.`)
    console.log(`A later re-claim needs a fresh login: --email <another @eno.vn address>.`)
  } else if (r.ownerProfileId) {
    console.log(`${r.name}: this run's login ${r.ownerProfileId} does not own it (owner now ${s.ownerId ?? 'none'}) → ban that login; deleting it is your call in Supabase`)
    if (s.officialPartner !== r.priorOfficialPartner) console.log(`  ⚠️ officialPartner is ${s.officialPartner}, was ${r.priorOfficialPartner} before the claim — left as it is; set-official-partner.mjs if it should go back`)
    if (!APPLY) return dry()
    await banLogin(r.ownerProfileId)
    // Ownership read again AFTER the ban (codex, commit gate): if this login came to own the shop meanwhile, the record
    // stays and the next --reverse takes the detach path.
    const after = (await c.query(`select "ownerId" from "Seller" where id = $1`, [r.sellerId])).rows[0]?.ownerId
    if (after === r.ownerProfileId) throw new Error(`login ${r.ownerProfileId} now OWNS ${r.name} — banned, record kept: re-run --reverse --apply to detach it`)
    archive('banned')
    console.log('\nBanned.')
  } else {
    // No id of its own: report, never act (see the header).
    const found = await findAuthUser(r.email).then((u) => u, (e) => ({ error: e.message }))
    console.log(`${r.name}: this run recorded no login of its own (record '${r.status}', started ${r.startedAt}); the shop's owner is ${s.ownerId ?? 'none'}.`)
    console.log(found?.error ? `  login lookup failed: ${found.error}` : found ? `  a login exists for ${r.email}: ${found.id}, created ${found.created_at}` : `  no login exists for ${r.email}`)
    console.log(`  NOTHING done. Settle it in Supabase (ban or delete that login if it is this run's), then: mv ${CLAIM_FILE} ${CLAIM_FILE}.settled; mv ${PW_FILE} ${PW_FILE}.settled`)
  }
}

if (APPLY) takeLock()
await c.connect()
try { await (REVERSE ? reverse() : claim()) } finally { await c.end() }
