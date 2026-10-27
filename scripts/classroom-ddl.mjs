// eno Classroom DDL (2026-10-25) — the seven tables of src/lib/classroom + its runtime switch. Idempotent: a re-run with
// nothing to change takes NO lock on a live table (round 9, codex — each step runs only when there is something to do).
//
//   set -a; . ./.env; set +a; node scripts/classroom-ddl.mjs            # apply
//   set -a; . ./.env; set +a; node scripts/classroom-ddl.mjs --check    # read-only: what exists, nothing written
//
// ⛔ NEW TABLES ONLY. Nothing existing is altered (the FKs to "Profile" and "TeacherProfile" add constraints on the NEW
// tables only), so no running revision is affected. Run it on production BEFORE the deploy that ships the classroom code.
// ⛔ RLS ON, NO POLICIES, NO GRANT TO THE API ROLES — asserted (the teachers-ddl.mjs rule, and calls-ddl.mjs's "RLS is not
// what keeps PostgREST out, grants are"): the app reads these through Prisma (BYPASSRLS) only.
// ⛔ ONE TRANSACTION: a failing step rolls everything back; every exit before COMMIT leaves nothing behind.
// ⛔ The columns must match prisma/schema.prisma exactly — src/lib/classroom/ddl.test.ts reads both files and fails if they
// drift, and checks every CHECK list below against src/lib/classroom/constants.ts.
// ⛔ THE FOUR PARTIAL UNIQUE INDEXES ARE RULES (plan review + core review): one live session per learner and one live
// test per teacher (a double tap or two tabs never start two billed sessions), one "me" per account, one active seat per
// learner per class. Prisma cannot declare a partial index, so `prisma migrate diff` lists all four as DROPs — refuse
// those (prisma/CLAUDE.md), exactly as for the partial Listing indexes. ddl.test.ts pins all four.
// ⛔ classroom_config IS LOGGED, NOT kv (the calls rule): a Postgres crash must not quietly reopen a switched-off classroom.
// ⛔ ONCE THESE TABLES HOLD ROWS, A NEW INDEX DOES NOT GO IN HERE (prisma/CLAUDE.md, round 8 opus): inside this transaction
// a plain CREATE INDEX blocks every write to the table while it builds — add it as its own CREATE INDEX CONCURRENTLY step,
// outside the transaction, and only then declare it here (the shape check compares it).

import pg from 'pg'
import { readFileSync } from 'node:fs'

const check = process.argv.includes('--check')
const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const TABLES = ['ClassroomAvatar', 'ClassroomLearner', 'ClassroomEnrollment', 'ClassroomPlan', 'ClassroomSession', 'ClassroomTurn', 'ClassroomFeedback', 'classroom_config', 'classroom_likeness_deletion']

// FKs — Prisma's own names and actions, so `prisma migrate diff` shows no drift for them.
const FKS = [
  ['ClassroomAvatar', 'teacherProfileId', 'TeacherProfile'],
  ['ClassroomLearner', 'ownerId', 'Profile'],
  ['ClassroomEnrollment', 'avatarId', 'ClassroomAvatar'],
  ['ClassroomEnrollment', 'learnerId', 'ClassroomLearner'],
  ['ClassroomPlan', 'enrollmentId', 'ClassroomEnrollment'],
  ['ClassroomSession', 'enrollmentId', 'ClassroomEnrollment'],
  ['ClassroomSession', 'avatarId', 'ClassroomAvatar'],
  ['ClassroomSession', 'learnerId', 'ClassroomLearner'],
  ['ClassroomTurn', 'sessionId', 'ClassroomSession'],
  ['ClassroomFeedback', 'sessionId', 'ClassroomSession'],
]

const client = new pg.Client({ connectionString: url })
await client.connect()

// The likeness trigger and its function — one text, used to create them AND to check them (shapeProblems).
// ⛔ THE LIFECYCLE, ONE RULE (review rounds 3–5, codex + opus — each patch to an id-reuse rule opened the next race, so
// reuse is simply gone): A SPATIUS ID IS GIVEN OUT AT MOST ONCE. Any id let go — an avatar deleted, an id replaced or
// withdrawn — is queued for deletion, and an id that is in the queue (pending OR done) can never be given out again;
// a mistake means making a new likeness. A request withdrawn (or erased) BEFORE its id was pasted queues a marker,
// 'request:<avatar id>', for whatever the admin already made in Studio (named eno-<avatar id> there — /admin/classroom),
// and no new request starts until that marker is done — so the name always means one likeness.
// Each id is taken under its own advisory lock, in a fixed order, so a release and a give-out of one id never interleave.
const QUEUE_FN_BODY = `
  declare
    ids text[] := array(select distinct x from unnest(array[old."spatiusAvatarId", new."spatiusAvatarId"]) x where x is not null order by x);
    x text;
  begin
    foreach x in array ids loop
      perform pg_advisory_xact_lock(hashtextextended('eno-classroom-likeness:' || x, 0));
    end loop;
    -- A NEW REQUEST WAITS FOR THE LAST ONE'S CLEAN-UP (round 7, opus): a 'request:<id>' marker means "delete what was made
    -- in Studio as eno-<id>" — a second request would get a likeness of that same name, and the marker would delete it.
    if tg_op = 'UPDATE' and new."customStatus" = 'requested' and old."customStatus" is distinct from 'requested'
       and exists (select 1 from public.classroom_likeness_deletion where spatius_avatar_id = 'request:' || new."id" and done_at is null) then
      raise exception 'classroom: the last likeness request of % is still being deleted', new."id" using errcode = 'check_violation';
    end if;
    if tg_op <> 'DELETE' and new."spatiusAvatarId" is not null
       and (tg_op = 'INSERT' or new."spatiusAvatarId" is distinct from old."spatiusAvatarId")
       and exists (select 1 from public.classroom_likeness_deletion where spatius_avatar_id = new."spatiusAvatarId") then
      raise exception 'classroom: likeness % was let go before and is never given out again', new."spatiusAvatarId" using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' then
      return new;
    end if;
    if old."spatiusAvatarId" is not null and (tg_op = 'DELETE' or new."spatiusAvatarId" is distinct from old."spatiusAvatarId") then
      insert into public.classroom_likeness_deletion (spatius_avatar_id, reason)
      values (old."spatiusAvatarId", case when tg_op = 'DELETE' then 'erased' else 'withdrawn' end)
      on conflict (spatius_avatar_id) do nothing;
    elsif old."spatiusAvatarId" is null and old."customStatus" = 'requested'
       and (tg_op = 'DELETE' or new."customStatus" in ('none', 'removed')) then
      insert into public.classroom_likeness_deletion (spatius_avatar_id, reason)
      values ('request:' || old."id", case when tg_op = 'DELETE' then 'erased' else 'withdrawn' end)
      on conflict (spatius_avatar_id) do update set reason = excluded.reason, queued_at = now(), done_at = null, done_by = null;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end `
const QUEUE_TRIGGER = 'ClassroomAvatar_queue_likeness'
const queueTriggerSql = (on) => `create trigger "${QUEUE_TRIGGER}" before insert or delete or update of "spatiusAvatarId", "customStatus" on ${on}
  for each row execute function public.classroom_queue_likeness()`

/**
 * ⛔ THE SHAPE IS POSTGRES'S TO COMPARE, NOT A PARSER'S (core review rounds 1–2, codex + opus). "IF NOT EXISTS" never
 * repairs a table, and each hand-written "is it the declared one?" missed a case — a CHECK's body, an index's predicate,
 * a default, an UNLOGGED table. So the declared tables are built AGAIN as TEMP tables of the same names (this file's own
 * CREATE TABLE and CREATE INDEX text, the trigger above), and Postgres's renderings of the two are compared: every
 * column (type, NOT NULL, default), every constraint by name and definition, every index by name and definition and
 * validity (both ways — an index nobody declared is reported too), the foreign keys, the trigger, enabled, and its
 * function's source. Plus: RLS on, no policy, LOGGED, and no grant to the API roles or PUBLIC. Inside a SAVEPOINT that
 * is rolled back, so the temp tables never outlive the check. Run by --check, and before COMMIT: a problem rolls the
 * whole run back and exits 3.
 */
const SOURCE = readFileSync(new URL(import.meta.url), 'utf8')
const qualified = (t) => (t.startsWith('classroom_') ? `public.${t}` : `"${t}"`)
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function declaredTableBody(t) {
  const m = new RegExp(`create table if not exists ${reEsc(qualified(t))} \\(([\\s\\S]*?)\\n  \\)\``).exec(SOURCE)
  if (!m) throw new Error(`no CREATE TABLE for ${t} in this file`)
  return m[1]
}
function declaredIndexes(t) {
  return [...SOURCE.matchAll(new RegExp(`create (unique )?index if not exists "(\\w+)" on ${reEsc(qualified(t))}(\\([^\`]*)\``, 'g'))]
    .map(([, unique, name, rest]) => `create ${unique ?? ''}index "${name}" on pg_temp.${qualified(t).replace(/^public\./, '')}${rest}`)
}
// "… ON public."T" USING …" and "… ON pg_temp_3."T" USING …" are the same index — and so is "… ON pg_temp."T" …":
// ⛔ Postgres 16+ prints the session's own temp schema as plain `pg_temp` (ruleutils' get_namespace_name_or_temp), 14 as
// `pg_temp_<n>` — production refused the first run on that difference alone (2026-10-27, every index and the trigger
// reported WRONG, rolled back, nothing written). Both spellings, so the check reads the same on either.
const sameTable = (def) => def.replace(/ ON (?:public|pg_temp(?:_\d+)?)\./, ' ON ')
const FK_SPEC = () => FKS.map(([table, col, ref]) => ({ table, col, ref, name: `${table}_${col}_fkey` }))

async function rowsOf(client, sql, params) { return (await client.query(sql, params)).rows }
async function columnsOf(client, oid) {
  return new Map((await rowsOf(client, `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null, pg_get_expr(d.adbin, d.adrelid) as def
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped`, [oid])).map((r) => [r.name, `${r.type}${r.not_null ? ' not null' : ''}${r.def ? ` default ${r.def}` : ''}`]))
}
async function constraintsOf(client, oid) {
  return new Map((await rowsOf(client, `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1 and contype <> 'f'`, [oid])).map((r) => [r.conname, r.def]))
}
async function indexesOf(client, oid) {
  return new Map((await rowsOf(client, `select i.relname as name, pg_get_indexdef(x.indexrelid) as def, x.indisvalid as valid
    from pg_index x join pg_class i on i.oid = x.indexrelid where x.indrelid = $1`, [oid])).map((r) => [r.name, `${sameTable(r.def)}${r.valid ? '' : ' [INVALID]'}`]))
}
async function triggersOf(client, oid) {
  return new Map((await rowsOf(client, `select tgname, pg_get_triggerdef(oid) as def, tgenabled from pg_trigger where tgrelid = $1 and not tgisinternal`, [oid]))
    .map((r) => [r.tgname, `${sameTable(r.def)}${r.tgenabled === 'O' ? '' : ` [tgenabled=${r.tgenabled}]`}`]))
}
function compare(problems, what, t, want, have) {
  for (const [k, v] of want) {
    if (!have.has(k)) problems.push(`${t}: ${what} ${k} MISSING (declared: ${v})`)
    else if (have.get(k) !== v) problems.push(`${t}: ${what} ${k} is "${have.get(k)}", declared "${v}"`)
  }
  for (const [k, v] of have) if (!want.has(k)) problems.push(`${t}: ${what} ${k} is not declared here (${v})`)
}

async function shapeProblems(client) {
  const problems = []
  await client.query('savepoint classroom_shape')
  try {
    const fn = await rowsOf(client, `select prosrc from pg_proc where oid = to_regprocedure('public.classroom_queue_likeness()')`)
    if (!fn.length) problems.push('function public.classroom_queue_likeness() MISSING')
    else if (fn[0].prosrc !== QUEUE_FN_BODY) problems.push('function public.classroom_queue_likeness() is not the declared one')
    const fnOpen = (await rowsOf(client, `select coalesce(r.rolname, 'PUBLIC') as who from pg_proc p cross join aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      left join pg_roles r on r.oid = a.grantee where p.oid = to_regprocedure('public.classroom_queue_likeness()') and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))`))
    for (const r of fnOpen) problems.push(`function public.classroom_queue_likeness() is executable by ${r.who}`)

    for (const t of TABLES) {
      const real = (await rowsOf(client, `select c.oid, c.relrowsecurity as rls, c.relpersistence as persistence,
          (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = $1)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`, [t]))[0]
      if (!real) { problems.push(`MISSING table ${t}`); continue }
      if (!real.rls) problems.push(`NO RLS on ${t}`)
      // LOGGED (core review, codex): an UNLOGGED switch is emptied by a crash — the very failure classroom_config exists to survive.
      if (real.persistence !== 'p') problems.push(`${t} is not a LOGGED table (relpersistence ${real.persistence})`)
      if (real.policies) problems.push(`${t} carries ${real.policies} RLS policies (expected none)`)
      const open = await rowsOf(client, `select coalesce(r.rolname, 'PUBLIC') as who, a.privilege_type as priv
        from pg_class c cross join aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
        where c.oid = $1 and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))`, [real.oid])
      for (const g of open) problems.push(`${t} grants ${g.priv} to ${g.who}`)
      // Column grants too (round 9, codex): a GRANT SELECT ("learnerText") would not show in relacl.
      const colOpen = await rowsOf(client, `select att.attname as col, coalesce(r.rolname, 'PUBLIC') as who, a.privilege_type as priv
        from pg_attribute att cross join aclexplode(att.attacl) a left join pg_roles r on r.oid = a.grantee
        where att.attrelid = $1 and att.attacl is not null and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))`, [real.oid])
      for (const g of colOpen) problems.push(`${t}.${g.col} grants ${g.priv} to ${g.who}`)

      // The declared table, built again in pg_temp under the SAME name (so every derived name — a pkey, a NOT NULL, an
      // inline CHECK — comes out the same), with its declared indexes.
      await client.query(`create temp table ${qualified(t).replace(/^public\./, '')} (${declaredTableBody(t)}\n  )`)
      const want = (await rowsOf(client, `select c.oid from pg_class c where c.oid = to_regclass($1)`, [`pg_temp.${qualified(t).replace(/^public\./, '')}`]))[0]
      for (const sql of declaredIndexes(t)) await client.query(sql)
      if (t === 'ClassroomAvatar' && fn.length) await client.query(queueTriggerSql('pg_temp."ClassroomAvatar"'))

      compare(problems, 'column', t, await columnsOf(client, want.oid), await columnsOf(client, real.oid))
      compare(problems, 'constraint', t, await constraintsOf(client, want.oid), await constraintsOf(client, real.oid))
      compare(problems, 'index', t, await indexesOf(client, want.oid), await indexesOf(client, real.oid))
      if (fn.length) compare(problems, 'trigger', t, await triggersOf(client, want.oid), await triggersOf(client, real.oid))

      // Foreign keys can't be built on a temp table (it may reference only temp tables), so they are compared by parts.
      const wantFks = new Map(FK_SPEC().filter((f) => f.table === t).map((f) => [f.name, `("${f.col}") → public."${f.ref}"(id) on delete c, on update c, validated`]))
      const haveFks = new Map((await rowsOf(client, `select c.conname, (select string_agg(format('%I', attname), ',') from pg_attribute where attrelid = c.conrelid and attnum = any(c.conkey)) as cols,
          c.confrelid::regclass::text as ref, (select string_agg(attname, ',') from pg_attribute where attrelid = c.confrelid and attnum = any(c.confkey)) as ref_cols,
          c.confdeltype, c.confupdtype, c.convalidated
        from pg_constraint c where c.conrelid = $1 and c.contype = 'f'`, [real.oid]))
        .map((r) => [r.conname, `(${r.cols}) → ${r.ref.startsWith('public.') ? r.ref : `public.${r.ref}`}(${r.ref_cols}) on delete ${r.confdeltype}, on update ${r.confupdtype}, ${r.convalidated ? 'validated' : 'NOT VALID'}`]))
      compare(problems, 'foreign key', t, wantFks, haveFks)
    }
  } finally {
    await client.query('rollback to savepoint classroom_shape')
    await client.query('release savepoint classroom_shape')
  }
  return problems
}

if (check) {
  await client.query('begin')
  const problems = await shapeProblems(client)
  await client.query('rollback')
  for (const p of problems) console.log(`WRONG  ${p}`)
  if (!problems.length) console.log(`ok     ${TABLES.length} tables as declared — every column, constraint, index, key and the trigger; RLS on, no policy, no grant`)
  await client.end()
  process.exit(problems.length ? 3 : 0)
}

await client.query('begin')
// The FKs need a short lock on "Profile" and "TeacherProfile"; never queue sign-ins behind a long wait. A timeout rolls
// back; re-run.
await client.query("set local lock_timeout = '5s'")

// ⛔ A CLEAN RE-RUN TAKES NO LOCK ON A LIVE TABLE (round 9, codex): CREATE INDEX IF NOT EXISTS takes a SHARE lock on its
// table BEFORE it finds the index, and ALTER TABLE … ENABLE ROW LEVEL SECURITY an ACCESS EXCLUSIVE one — both held to
// COMMIT. So an index is built only when it is missing (on a table that already holds rows, see the header: CONCURRENTLY,
// on its own), RLS is switched on only when it is off, grants are revoked only when one exists, the trigger is made only
// when it is missing (a CHANGED trigger is named by the shape check — drop it by hand, then re-run).
async function ensureIndex(sql) {
  const name = /index if not exists "(\w+)"/.exec(sql)[1]
  if ((await client.query('select to_regclass($1) as r', [`public."${name}"`])).rows[0].r) return
  await client.query(sql)
}
/**
 * A column added after the table was first made (the voice pace, 2026-10-26): CREATE TABLE IF NOT EXISTS never adds one
 * to a table that exists. Added — with its CHECK — only when it is missing, so a clean re-run takes no lock (the rule
 * above); a nullable column with no default is a catalogue change, not a rewrite. The shape check then compares it with
 * the declared table like every other column.
 */
async function ensureColumn(table, column, type, check) {
  const has = await client.query(`select 1 from pg_attribute where attrelid = to_regclass($1) and attname = $2 and not attisdropped`, [`public."${table}"`, column])
  if (!has.rowCount) await client.query(`alter table "${table}" add column "${column}" ${type}`)
  // The CHECK on its own (2026-10-26 review, opus): one transaction makes the pair atomic, but a column made by hand
  // without it still gets it.
  const named = `${table}_${column}_check`
  const hasCheck = await client.query(`select 1 from pg_constraint where conrelid = to_regclass($1) and conname = $2`, [`public."${table}"`, named])
  if (!hasCheck.rowCount) await client.query(`alter table "${table}" add constraint "${named}" check (${check})`)
}
process.on('unhandledRejection', async (e) => { console.error(e); try { await client.query('rollback') } catch {} process.exit(1) })

const exists = await client.query(`select to_regclass('public."TeacherProfile"') as t`)
if (!exists.rows[0].t) { console.error('TeacherProfile does not exist — run the teacher DDL first.'); process.exit(1) }

await client.query(`
  create table if not exists "ClassroomAvatar" (
    "id" text not null,
    "teacherProfileId" text not null,
    "name" text not null,
    "persona" text not null default '',
    "traits" jsonb not null default '{}',
    "greeting" text not null default '',
    "voice" text not null,
    "look" text not null default 'photo',
    "libraryAvatarId" text,
    "customStatus" text not null default 'none',
    "spatiusAvatarId" text,
    "photoConsentVersion" text,
    "photoConsentAt" timestamp(3),
    "photoWithdrawnAt" timestamp(3),
    "createdAt" timestamp(3) not null default current_timestamp,
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "ClassroomAvatar_pkey" primary key ("id"),
    constraint "ClassroomAvatar_look_check" check ("look" in ('photo', 'library', 'custom')),
    constraint "ClassroomAvatar_customStatus_check" check ("customStatus" in ('none', 'requested', 'ready', 'removed')),
    constraint "ClassroomAvatar_text_bounds" check (char_length("id") <= 64 and char_length("name") between 1 and 60 and char_length("persona") <= 2000 and char_length("greeting") <= 300),
    -- A likeness is 'ready' exactly when its Spatius id is on the row (round 6, opus): no state in which the trigger below
    -- could read a half-made edit — the admin's "ready" and its id land together or not at all.
    constraint "ClassroomAvatar_ready_has_id" check (("customStatus" = 'ready') = ("spatiusAvatarId" is not null)),
    constraint "ClassroomAvatar_look_rules" check ("look" <> 'library' or "libraryAvatarId" is not null),
    -- A withdrawn photo consent leaves no likeness in use, and the 3D look needs a ready likeness (round 8, opus).
    constraint "ClassroomAvatar_consent_rules" check (("photoWithdrawnAt" is null or "customStatus" in ('none', 'removed')) and ("look" <> 'custom' or "customStatus" = 'ready')),
    -- The likeness queue's own bounds (round 3, codex): an id the queue would refuse must never be stored here, or the
    -- trigger below would fail — and with it the account erasure that deletes the avatar. The admin route's pattern
    -- (no ':' — so an id can never look like a 'request:' marker, round 9 opus).
    constraint "ClassroomAvatar_spatius_id_bounds" check ("spatiusAvatarId" is null or "spatiusAvatarId" ~ '^[A-Za-z0-9_-]{4,120}$')
  )`)
await ensureIndex(`create unique index if not exists "ClassroomAvatar_teacherProfileId_key" on "ClassroomAvatar"("teacherProfileId")`)
// One likeness, one avatar (round 3, opus): deleting or replacing an avatar's id queues THAT likeness for deletion.
await ensureIndex(`create unique index if not exists "ClassroomAvatar_spatiusAvatarId_key" on "ClassroomAvatar"("spatiusAvatarId")`)

await client.query(`
  create table if not exists "ClassroomLearner" (
    "id" text not null,
    "ownerId" uuid not null,
    "kind" text not null,
    "displayName" text not null,
    "birthYear" integer,
    "practiceConsentVersion" text,
    "practiceConsentAt" timestamp(3),
    "teacherViewConsentVersion" text,
    "teacherViewConsentAt" timestamp(3),
    "guardianAttestedAt" timestamp(3),
    "adultAttestedAt" timestamp(3),
    "assentAt" timestamp(3),
    "withdrawnAt" timestamp(3),
    "createdAt" timestamp(3) not null default current_timestamp,
    "updatedAt" timestamp(3) not null default current_timestamp,
    "voicePace" text,
    constraint "ClassroomLearner_pkey" primary key ("id"),
    constraint "ClassroomLearner_kind_check" check ("kind" in ('self', 'child')),
    constraint "ClassroomLearner_voicePace_check" check ("voicePace" is null or "voicePace" in ('slowest', 'gentle', 'natural', 'quick')),
    constraint "ClassroomLearner_child_rules" check (
      ("kind" = 'child') = ("birthYear" is not null)
      and ("kind" <> 'child' or "guardianAttestedAt" is not null)
      and ("kind" <> 'self' or "adultAttestedAt" is not null)
      and ("birthYear" is null or "birthYear" between 2000 and 2100)),
    constraint "ClassroomLearner_text_bounds" check (char_length("displayName") between 1 and 40)
  )`)
await ensureColumn('ClassroomLearner', 'voicePace', 'text', `"voicePace" is null or "voicePace" in ('slowest', 'gentle', 'natural', 'quick')`)
await ensureIndex(`create index if not exists "ClassroomLearner_ownerId_idx" on "ClassroomLearner"("ownerId")`)
// ⛔ ONE "self" LEARNER PER ACCOUNT (core review, opus): two quick joins must not make two "me"s.
await ensureIndex(`create unique index if not exists "ClassroomLearner_one_self" on "ClassroomLearner"("ownerId") where "kind" = 'self'`)

await client.query(`
  create table if not exists "ClassroomEnrollment" (
    "id" text not null,
    "avatarId" text not null,
    "learnerId" text,
    "seatName" text not null,
    "inviteCode" text,
    "inviteExpiresAt" timestamp(3),
    "status" text not null default 'invited',
    "level" text not null default 'A2',
    "sessionMinutes" integer not null default 10,
    "sessionsPerWeek" integer not null default 3,
    "strictness" text not null default 'balanced',
    "focusNote" text not null default '',
    "focusItems" jsonb not null default '[]',
    "claimedAt" timestamp(3),
    "removedAt" timestamp(3),
    "createdAt" timestamp(3) not null default current_timestamp,
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "ClassroomEnrollment_pkey" primary key ("id"),
    constraint "ClassroomEnrollment_status_check" check ("status" in ('invited', 'active', 'paused', 'removed')),
    constraint "ClassroomEnrollment_level_check" check ("level" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
    constraint "ClassroomEnrollment_sessionMinutes_check" check ("sessionMinutes" in (5, 10, 15, 20)),
    constraint "ClassroomEnrollment_strictness_check" check ("strictness" in ('soft', 'balanced', 'strict')),
    constraint "ClassroomEnrollment_bounds" check (
      ("sessionsPerWeek" between 1 and 7)
      and char_length("seatName") between 1 and 60 and char_length("focusNote") <= 500
      and ("status" <> 'invited' or "learnerId" is null)
      and ("status" not in ('active', 'paused') or "learnerId" is not null)
      and ("status" in ('invited') or "inviteCode" is null)
      -- a one-use code always has its expiry (round 8, opus)
      and ("inviteCode" is null or "inviteExpiresAt" is not null)
      -- ⛔ A CLAIMED SEAT IS NEVER INVITED AGAIN (round 10, opus): its notes, "Working on", plans and sessions are ONE
      -- learner's — a re-invite would hand them to another family. A new learner gets a new seat.
      and ("status" <> 'invited' or "claimedAt" is null)
      and (("status" = 'removed') = ("removedAt" is not null)))
  )`)
await ensureIndex(`create unique index if not exists "ClassroomEnrollment_inviteCode_key" on "ClassroomEnrollment"("inviteCode")`)
await ensureIndex(`create index if not exists "ClassroomEnrollment_avatarId_status_idx" on "ClassroomEnrollment"("avatarId", "status")`)
await ensureIndex(`create index if not exists "ClassroomEnrollment_learnerId_idx" on "ClassroomEnrollment"("learnerId")`)
// ⛔ ONE ACTIVE SEAT PER LEARNER PER CLASS (core review, opus): two seats in one class would double the day's sessions.
await ensureIndex(`create unique index if not exists "ClassroomEnrollment_one_seat_per_class" on "ClassroomEnrollment"("avatarId", "learnerId") where "status" in ('active', 'paused')`)

await client.query(`
  create table if not exists "ClassroomPlan" (
    "id" text not null,
    "enrollmentId" text not null,
    "source" text not null,
    "status" text not null default 'draft',
    "brief" text not null,
    "focus" jsonb not null default '{}',
    "openingLine" text not null default '',
    "fromSessionId" text,
    "createdAt" timestamp(3) not null default current_timestamp,
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "ClassroomPlan_pkey" primary key ("id"),
    constraint "ClassroomPlan_source_check" check ("source" in ('ai', 'teacher')),
    constraint "ClassroomPlan_status_check" check ("status" in ('draft', 'approved', 'used')),
    constraint "ClassroomPlan_text_bounds" check (char_length("brief") between 1 and 2000 and char_length("openingLine") <= 300)
  )`)
await ensureIndex(`create index if not exists "ClassroomPlan_enrollmentId_status_idx" on "ClassroomPlan"("enrollmentId", "status")`)

await client.query(`
  create table if not exists "ClassroomSession" (
    "id" text not null,
    "enrollmentId" text,
    "avatarId" text not null,
    "learnerId" text,
    "testerId" uuid,
    "planId" text,
    "planSnapshot" jsonb not null default '{}',
    "status" text not null default 'live',
    "endReason" text,
    "mode" text not null default 'avatar',
    "startedAt" timestamp(3) not null default current_timestamp,
    "endsAt" timestamp(3) not null,
    "endedAt" timestamp(3),
    "reservedMinutes" integer not null,
    "usedSeconds" integer not null default 0,
    "tokenMints" integer not null default 0,
    "turnCount" integer not null default 0,
    "learnerSpeechMs" integer not null default 0,
    "avatarChars" integer not null default 0,
    "costMicroUsd" integer not null default 0,
    "feedbackStatus" text not null default 'pending',
    "feedbackAttempts" integer not null default 0,
    "createdAt" timestamp(3) not null default current_timestamp,
    "updatedAt" timestamp(3) not null default current_timestamp,
    "voicePace" text,
    constraint "ClassroomSession_pkey" primary key ("id"),
    constraint "ClassroomSession_voicePace_check" check ("voicePace" is null or "voicePace" in ('slowest', 'gentle', 'natural', 'quick')),
    constraint "ClassroomSession_status_check" check ("status" in ('live', 'ended')),
    constraint "ClassroomSession_endReason_check" check ("endReason" is null or "endReason" in ('learner', 'time', 'abandoned', 'kill_switch')),
    constraint "ClassroomSession_mode_check" check ("mode" in ('avatar', 'voice')),
    constraint "ClassroomSession_feedbackStatus_check" check ("feedbackStatus" in ('pending', 'ready', 'failed')),
    constraint "ClassroomSession_owner_rules" check (
      ("enrollmentId" is null) = ("testerId" is not null)
      and ("enrollmentId" is null) = ("learnerId" is null)
      and ("status" <> 'ended' or "endedAt" is not null)
      and "reservedMinutes" between 1 and 20 and "usedSeconds" >= 0 and "turnCount" between 0 and 200)
  )`)
await ensureColumn('ClassroomSession', 'voicePace', 'text', `"voicePace" is null or "voicePace" in ('slowest', 'gentle', 'natural', 'quick')`)
await ensureIndex(`create index if not exists "ClassroomSession_status_endsAt_idx" on "ClassroomSession"("status", "endsAt")`)
await ensureIndex(`create index if not exists "ClassroomSession_enrollmentId_startedAt_idx" on "ClassroomSession"("enrollmentId", "startedAt")`)
await ensureIndex(`create index if not exists "ClassroomSession_avatarId_startedAt_idx" on "ClassroomSession"("avatarId", "startedAt")`)
// A learner's sessions (the erasure cascade, the home's list) — the live-only partial index cannot serve them (round 4, opus).
await ensureIndex(`create index if not exists "ClassroomSession_learnerId_startedAt_idx" on "ClassroomSession"("learnerId", "startedAt")`)
// ⛔ ONE LIVE SESSION PER LEARNER, AND ONE LIVE TEST PER TEACHER — the database's half of the start lock (session.ts).
await ensureIndex(`create unique index if not exists "ClassroomSession_one_live_learner" on "ClassroomSession"("learnerId") where "status" = 'live' and "learnerId" is not null`)
await ensureIndex(`create unique index if not exists "ClassroomSession_one_live_tester" on "ClassroomSession"("testerId") where "status" = 'live' and "testerId" is not null`)

await client.query(`
  create table if not exists "ClassroomTurn" (
    "id" text not null,
    "sessionId" text not null,
    "seq" integer not null,
    "clientTurnId" text,
    "status" text not null default 'processing',
    "learnerText" text,
    "replyText" text not null default '',
    "hint" text not null default '',
    "hintVi" text not null default '',
    "expectText" text,
    "reference" text,
    "heardAs" jsonb not null default '[]',
    "pron" jsonb,
    "assessStatus" text not null default 'skipped',
    "flag" text,
    "aiCalls" integer not null default 0,
    "learnerMs" integer not null default 0,
    "createdAt" timestamp(3) not null default current_timestamp,
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "ClassroomTurn_pkey" primary key ("id"),
    constraint "ClassroomTurn_status_check" check ("status" in ('processing', 'ok', 'failed')),
    constraint "ClassroomTurn_assessStatus_check" check ("assessStatus" in ('pending', 'done', 'failed', 'skipped')),
    constraint "ClassroomTurn_flag_check" check ("flag" is null or "flag" in ('harm')),
    constraint "ClassroomTurn_bounds" check ("seq" between 0 and 200 and "learnerMs" between 0 and 60000 and "aiCalls" between 0 and 20)
  )`)
await ensureIndex(`create unique index if not exists "ClassroomTurn_sessionId_seq_key" on "ClassroomTurn"("sessionId", "seq")`)
await ensureIndex(`create unique index if not exists "ClassroomTurn_sessionId_clientTurnId_key" on "ClassroomTurn"("sessionId", "clientTurnId")`)

await client.query(`
  create table if not exists "ClassroomFeedback" (
    "sessionId" text not null,
    "summary" text not null,
    "summaryVi" text not null default '',
    "wins" jsonb not null default '[]',
    "mistakes" jsonb not null default '[]',
    "pronunciation" jsonb not null default '[]',
    "vocabulary" jsonb not null default '{}',
    "scores" jsonb not null default '{}',
    "safetyFlag" text,
    "teacherNote" text not null default '',
    "teacherSeenAt" timestamp(3),
    "learnerSeenAt" timestamp(3),
    "createdAt" timestamp(3) not null default current_timestamp,
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "ClassroomFeedback_pkey" primary key ("sessionId"),
    constraint "ClassroomFeedback_text_bounds" check (char_length("teacherNote") <= 2000)
  )`)

// The runtime switch (src/lib/classroom/config.ts) — one row, LOGGED.
await client.query(`
  create table if not exists public.classroom_config (
    id                    smallint    primary key check (id = 1),
    mode                  text        not null default 'off' check (mode in ('off', 'staff', 'allowlist', 'all')),
    -- 'allowlist': these teachers' ACCOUNT ids (Profile.id) may run a class (staff always may); their learners follow them.
    cohort                uuid[]      not null default '{}',
    day_minutes           integer     not null default 300 check (day_minutes between 0 and 100000),
    month_minutes         integer     not null default 3000 check (month_minutes between 0 and 1000000),
    teacher_month_minutes integer     not null default 600 check (teacher_month_minutes between 0 and 100000),
    -- Spatius Terms §11: an animated avatar for an under-13 only after Spatius's written OK. Until then: voice-only.
    spatius_children_ok   boolean     not null default false,
    updated_at            timestamptz not null default now(),
    updated_by            text,
    -- Stamped by every run of /api/cron/classroom-sweep. Both writers of the switch refuse any mode but 'off' unless recent.
    swept_at              timestamptz
  )`)
await client.query(`insert into public.classroom_config (id) values (1) on conflict (id) do nothing`)

// Likenesses to delete at Spatius by hand — the ids a cascade cannot reach (src/lib/classroom/likeness.ts). LOGGED;
// an id, the reason and two times, nothing about the person.
await client.query(`
  create table if not exists public.classroom_likeness_deletion (
    -- A Spatius id (≤ 120, the avatar's own bound) or a 'request:<avatar id>' marker (≤ 8 + 64): both always fit, so the
    -- trigger's insert can never fail an erasure (round 6, codex).
    spatius_avatar_id text        primary key check (char_length(spatius_avatar_id) between 4 and 200),
    reason            text        not null check (reason in ('withdrawn', 'erased')),
    queued_at         timestamptz not null default now(),
    done_at           timestamptz,
    done_by           text
  )`)

// ⛔ THE LIKENESS QUEUE IS THE DATABASE'S, NOT A CALLER'S (core review, opus): a 3D likeness lives at Spatius, where no
// cascade reaches — so ANY path that deletes an avatar row (an account erasure, a teacher deleting their teacher profile,
// an admin, a hand-run DELETE) or replaces its Spatius id (a withdrawal) queues the old id here, in the same statement.
await client.query(`create or replace function public.classroom_queue_likeness() returns trigger language plpgsql as $fn$${QUEUE_FN_BODY}$fn$`)
// A trigger function's EXECUTE is checked at CREATE TRIGGER only, never when it fires (rls-guard.sql step 1c) — so
// nobody but its owner needs it, and PostgREST must not list it.
await client.query(`
  do $$ begin
    revoke execute on function public.classroom_queue_likeness() from public;
    if to_regrole('anon') is not null then revoke execute on function public.classroom_queue_likeness() from anon; end if;
    if to_regrole('authenticated') is not null then revoke execute on function public.classroom_queue_likeness() from authenticated; end if;
  end $$`)
if (!(await client.query(`select 1 from pg_trigger where tgname = $1 and tgrelid = '"ClassroomAvatar"'::regclass and not tgisinternal`, [QUEUE_TRIGGER])).rows.length) {
  await client.query(queueTriggerSql('"ClassroomAvatar"'))
}


for (const t of TABLES) {
  const q = t.startsWith('classroom_') ? `public.${t}` : `"${t}"`
  const cur = (await client.query(`select c.relrowsecurity as rls,
      exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
              where a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
      or exists (select 1 from pg_attribute att cross join aclexplode(att.attacl) a left join pg_roles r on r.oid = a.grantee
                 where att.attrelid = c.oid and att.attacl is not null and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as open
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`, [t])).rows[0]
  if (!cur.rls) await client.query(`alter table ${q} enable row level security`)
  // ⚠️⚠️ RLS IS NOT WHAT KEEPS PostgREST OUT, GRANTS ARE (calls-ddl.mjs, auth-handoff-ddl.mjs): Supabase's default
  // privileges hand anon/authenticated every new table. A table REVOKE takes its column grants with it (measured on a
  // scratch PG14). Role-checked, so a scratch database without those roles works too.
  if (cur.open) {
    await client.query(`
      do $$ begin
        revoke all on ${q} from public;
        if to_regrole('anon') is not null then revoke all on ${q} from anon; end if;
        if to_regrole('authenticated') is not null then revoke all on ${q} from authenticated; end if;
      end $$`)
  }
  const r = (await client.query(`select c.relrowsecurity as on, (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = $1)::int as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`, [t])).rows[0]
  if (!r?.on) { console.error(`RLS did not switch on for ${t} — stopping.`); process.exit(1) }
  if (r.policies) { console.error(`${t} carries ${r.policies} RLS policies — this script expects none. Stopping.`); process.exit(1) }
  console.log(`ok  RLS ${t}`)
}

// The FKs LAST (round 3, opus): each takes SHARE ROW EXCLUSIVE on "Profile" / "TeacherProfile" and holds it to COMMIT,
// so profile writes wait only for the shape check below (about a second, measured on a scratch database), not the whole run.
for (const [table, col, ref] of FKS) {
  const name = `${table}_${col}_fkey`
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_constraint where conname = '${name}' and conrelid = '"${table}"'::regclass) then
        alter table "${table}" add constraint "${name}"
          foreign key ("${col}") references "${ref}"("id") on delete cascade on update cascade;
      end if;
    end $$`)
  console.log(`ok  ${name}`)
}

const problems = await shapeProblems(client)
if (problems.length) {
  for (const p of problems) console.error(`WRONG  ${p}`)
  console.error('The database does not have the shape this script declares — rolled back. Fix the table by hand (or drop it on a scratch database) and re-run.')
  await client.query('rollback')
  process.exit(3)
}
await client.query('commit')
await client.end()
console.log('done — now run scripts/rls-guard.sql (prisma/CLAUDE.md).')
