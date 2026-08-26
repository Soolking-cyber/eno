// Footer live-stats DDL — "here / now" visitor counters, plus the member and seller counts.
// Idempotent; re-run any time.
//
//   set -a; . ./.env; set +a; node scripts/site-stats-ddl.mjs
//
// ⛔ NOT PRISMA-MANAGED, DELIBERATELY, AND THAT HAS A COST YOU MUST KNOW. Like rl_window,
// kv_store and the visa_* tables, these live outside prisma/schema.prisma — so `prisma db push`
// would generate DROP TABLE for every one of them. That is exactly why CLAUDE.md bans db push on
// this project; adding three more tables to that list does not change the rule, it reinforces it.
//
// ⚠️ LOGGED vs UNLOGGED IS THE WHOLE DESIGN HERE, and getting it backwards silently zeroes a
// number the footer presents as all-time:
//   · site_visit_total  LOGGED   — the all-time count. UNLOGGED is truncated on crash recovery,
//                                  which would reset "here" to zero after any unclean shutdown.
//   · site_visit_day    LOGGED   — today's already-counted visitors, so the total increments once
//                                  per visitor per day. Losing it would let one visitor re-count.
//   · site_presence     UNLOGGED — who is here in the last few minutes. Ephemeral by definition;
//                                  truncation costs nothing, and the write rate is a heartbeat.
//
// ⚠️ `site` IS PART OF EVERY KEY. eno.vn and eno.forum are one codebase over ONE database, so
// without it the two sites would pool their visitors and each would report the other's traffic.

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const statements = [
  `create table if not exists site_visit_total (
    site       text primary key,
    visitors   bigint not null default 0,
    updated_at timestamptz not null default now()
  )`,
  `alter table site_visit_total enable row level security`,

  `create table if not exists site_visit_day (
    site    text not null,
    day     date not null,
    visitor bytea not null,
    primary key (site, day, visitor)
  )`,
  `create index if not exists site_visit_day_day_idx on site_visit_day (day)`,
  `alter table site_visit_day enable row level security`,

  `create unlogged table if not exists site_presence (
    site    text not null,
    visitor bytea not null,
    seen_at timestamptz not null default now(),
    primary key (site, visitor)
  )`,
  `create index if not exists site_presence_seen_idx on site_presence (seen_at)`,
  `alter table site_presence enable row level security`,

  // ⛔ ONE ROUND TRIP, ONE TRANSACTION. The heartbeat runs on every page view of every visitor;
  // doing this as three statements from the app would trade a page-view-rate write burst for
  // three, and leave the "did this visitor already count today" check racing itself.
  // SECURITY DEFINER + a pinned search_path matches the rate-limiter's functions: the app holds no
  // direct grant on these tables, and a mutable search_path on a definer function is a privilege
  // escalation vector.
  `create or replace function site_touch(p_site text, p_visitor bytea, p_window interval)
   returns table (visitors bigint, now_count integer)
   language plpgsql security definer set search_path = public as $$
   declare v_rows integer := 0;
   begin
     insert into site_presence (site, visitor, seen_at) values (p_site, p_visitor, now())
       on conflict (site, visitor) do update set seen_at = now();

     -- ⛔ UTC EXPLICITLY, NOT current_date. The app's salt rotates on the UTC date, so if this
     -- used the SERVER's date and the server were not UTC, the two would disagree for the offset:
     -- the day key would flip while the salt had not, and every returning visitor in that window
     -- would be counted a second time. The database IS UTC today (checked) — which is exactly the
     -- kind of thing that is true until someone changes it, so it is pinned rather than assumed.
     -- ⚠️ The all-time total moves ONLY when today's insert actually happened. "on conflict do
     -- nothing" + FOUND is what makes a refresh free: the same visitor heartbeating every 45s
     -- inserts once per day and is a no-op for the rest of it.
     insert into site_visit_day (site, day, visitor) values (p_site, (now() at time zone 'UTC')::date, p_visitor)
       on conflict do nothing;
     -- ⚠️ ROW_COUNT is an INTEGER; declaring this boolean is a plpgsql type error at runtime.
     get diagnostics v_rows = row_count;

     if v_rows > 0 then
       insert into site_visit_total (site, visitors) values (p_site, 1)
         on conflict (site) do update set visitors = site_visit_total.visitors + 1, updated_at = now();
     end if;

     return query
       select coalesce((select t.visitors from site_visit_total t where t.site = p_site), 0)::bigint,
              (select count(*) from site_presence p where p.site = p_site and p.seen_at > now() - p_window)::integer;
   end $$`,

  // ⚠️ SWEEP BOTH, and keep a couple of days of site_visit_day rather than only today: a visitor
  // mid-session across midnight UTC would otherwise be re-counted, and the table is one narrow row
  // per visitor per day.
  `create or replace function site_stats_sweep() returns void
   language sql security definer set search_path = public as $$
     delete from site_presence where seen_at < now() - interval '1 hour';
     delete from site_visit_day where day < (now() at time zone 'UTC')::date - 2;
   $$`,

  // ⛔ REVOKE, BECAUSE SUPABASE PUBLISHES public-SCHEMA FUNCTIONS. PostgREST turns every function
  // in `public` into POST /rest/v1/rpc/<name>, and a function's DEFAULT grant is EXECUTE to PUBLIC —
  // measured here as `anon=X` before this line existed. So anyone holding the publishable anon key
  // could call rpc/site_touch with any p_site and a fresh p_visitor and drive the LOGGED all-time
  // counter directly, never touching the route or its limiter. SECURITY DEFINER makes that worse,
  // not better: the call would run with the owner's rights.
  // ⚠️ The app connects as `postgres`, which OWNS these and therefore keeps EXECUTE regardless.
  `revoke all on function site_touch(text, bytea, interval) from public, anon, authenticated`,
  `revoke all on function site_stats_sweep() from public, anon, authenticated`,
]

const client = new pg.Client({ connectionString: url })
await client.connect()
for (const s of statements) {
  await client.query(s)
  console.log('ok  ' + s.trim().split('\n')[0].slice(0, 78))
}
// pg_cron is already installed for the rate limiter's sweep; schedule beside it. Unschedule first
// so a re-run does not stack duplicate jobs under the same name.
try {
  await client.query(`select cron.unschedule('site-stats-sweep')`).catch(() => {})
  await client.query(`select cron.schedule('site-stats-sweep', '*/15 * * * *', 'select site_stats_sweep()')`)
  console.log('ok  cron: site-stats-sweep every 15 min')
} catch (e) {
  console.log('--  pg_cron not available (' + String(e.message).slice(0, 60) + ') — sweep must be scheduled another way')
}
await client.end()
console.log('\nsite-stats DDL applied')
