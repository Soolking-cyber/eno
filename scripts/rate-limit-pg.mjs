// Rate-limit / KV / trending / Zalo-token DDL — the Postgres replacement for
// Upstash Redis (owner directive 2026-07-20). Mirrors the live migration
// `replace_upstash_redis_with_postgres`; part of `npm run db:setup` so a DB
// reset restores the whole layer. Idempotent; re-run any time.
//
// Design: counters/locks/caches are UNLOGGED (no WAL ≈ Redis-fast; truncated on
// crash recovery — fine for throttles/caches). The Zalo OAuth chain is LOGGED
// (its refresh token is SINGLE-USE; losing it bricks the chain). All atomic
// semantics live in SECURITY DEFINER functions so the main app (Prisma raw SQL)
// and the forum (supabase-js RPC with the service key) share one implementation.
// Expiry: enforced on read + swept by pg_cron ('rl-kv-sweep', every 15 min).
//
//   set -a; . ./.env; set +a; node scripts/rate-limit-pg.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const statements = [
  `create unlogged table if not exists kv_store (
    key        text primary key,
    value      jsonb not null,
    expires_at timestamptz
  )`,
  `create index if not exists kv_store_expires_idx on kv_store (expires_at) where expires_at is not null`,
  `alter table kv_store enable row level security`,

  `create unlogged table if not exists rl_window (
    name         text not null,
    key          text not null,
    window_start timestamptz not null,
    count        integer not null,
    expires_at   timestamptz not null,
    primary key (name, key, window_start)
  )`,
  `create index if not exists rl_window_expires_idx on rl_window (expires_at)`,
  `alter table rl_window enable row level security`,

  `create unlogged table if not exists rl_cooldown (
    name     text not null,
    key      text not null,
    until    timestamptz not null,
    n        integer not null,
    reset_at timestamptz not null,
    primary key (name, key)
  )`,
  `alter table rl_cooldown enable row level security`,

  `create table if not exists zalo_oauth_token (
    id            smallint primary key check (id = 1),
    access_token  text not null,
    refresh_token text not null,
    expires_at    timestamptz not null,
    updated_at    timestamptz not null default now()
  )`,
  `alter table zalo_oauth_token enable row level security`,

  `create table if not exists search_trend (
    day   date not null,
    term  text not null,
    count integer not null,
    primary key (day, term)
  )`,
  `alter table search_trend enable row level security`,

  `create unlogged table if not exists search_trend_seen (
    day   date not null,
    actor text not null,
    term  text not null,
    primary key (day, actor, term)
  )`,
  `alter table search_trend_seen enable row level security`,

  // ISR/data cache for the Next cacheHandler (cache-handler.cjs) — entries carry
  // the same JSON envelope the Redis version stored; tombstones are build-agnostic
  // revalidateTag timestamps compared against entry.lastModified.
  `create unlogged table if not exists next_cache (
    key        text primary key,
    entry      jsonb not null,
    expires_at timestamptz not null
  )`,
  `alter table next_cache enable row level security`,

  `create unlogged table if not exists next_cache_tag (
    tag        text primary key,
    stamp      bigint not null,
    expires_at timestamptz not null
  )`,
  `alter table next_cache_tag enable row level security`,

  // Supabase default privileges grant table access to anon/authenticated — revoke.
  `revoke all on kv_store, rl_window, rl_cooldown, zalo_oauth_token, search_trend, search_trend_seen,
   next_cache, next_cache_tag
   from anon, authenticated`,

  // Upstash-compatible weighted two-window sliding limit. Increments FIRST,
  // then evaluates — a denied attempt still counts (extends the throttle under
  // sustained hammering; deliberate, safer divergence from @upstash/ratelimit).
  `create or replace function rl_check(p_name text, p_key text, p_limit int, p_window_sec int)
  returns table (success boolean, remaining int)
  language plpgsql security definer set search_path = public, pg_temp as $$
  declare
    v_now   timestamptz := now();
    v_start timestamptz := to_timestamp(floor(extract(epoch from v_now) / p_window_sec) * p_window_sec);
    v_curr  int;
    v_prev  int;
    v_used  numeric;
  begin
    insert into rl_window as w (name, key, window_start, count, expires_at)
    values (p_name, p_key, v_start, 1, v_start + make_interval(secs => 2 * p_window_sec))
    on conflict (name, key, window_start) do update set count = w.count + 1
    returning w.count into v_curr;

    select w.count into v_prev from rl_window w
     where w.name = p_name and w.key = p_key
       and w.window_start = v_start - make_interval(secs => p_window_sec);

    v_used := coalesce(v_prev, 0) * (1 - extract(epoch from (v_now - v_start)) / p_window_sec) + v_curr;
    success := v_used <= p_limit;
    remaining := greatest(0, p_limit - ceil(v_used))::int;
    return next;
  end $$`,

  // One-winner escalating cooldown (ports the audited Redis SET-NX gate): of N
  // concurrent claims exactly ONE is admitted — losers block on the row lock,
  // then read the winner's fresh cooldown for an honest retry-after. The
  // counter advances only on ALLOWED claims and resets 24h after the burst's
  // first allowed send.
  `create or replace function rl_cooldown_claim(p_name text, p_key text, p_steps int[])
  returns table (allowed boolean, retry_after_sec int)
  language plpgsql security definer set search_path = public, pg_temp as $$
  declare
    v_now  timestamptz := now();
    v_len  int := coalesce(array_length(p_steps, 1), 0);
    r      rl_cooldown;
    v_n    int;
    v_step int;
  begin
    if v_len = 0 then p_steps := array[60]; v_len := 1; end if;

    insert into rl_cooldown (name, key, until, n, reset_at)
    values (p_name, p_key, v_now + make_interval(secs => p_steps[1]), 1, v_now + interval '24 hours')
    on conflict (name, key) do nothing;
    if found then
      allowed := true; retry_after_sec := 0; return next; return;
    end if;

    select * into r from rl_cooldown c where c.name = p_name and c.key = p_key for update;
    if not found then
      insert into rl_cooldown (name, key, until, n, reset_at)
      values (p_name, p_key, v_now + make_interval(secs => p_steps[1]), 1, v_now + interval '24 hours');
      allowed := true; retry_after_sec := 0; return next; return;
    end if;

    if r.until > v_now then
      allowed := false;
      retry_after_sec := greatest(1, ceil(extract(epoch from (r.until - v_now))))::int;
      return next; return;
    end if;

    v_n := case when r.reset_at <= v_now then 1 else r.n + 1 end;
    v_step := p_steps[least(v_n, v_len)];
    update rl_cooldown c set
      n = v_n,
      until = v_now + make_interval(secs => v_step),
      reset_at = case when r.reset_at <= v_now then v_now + interval '24 hours' else r.reset_at end
    where c.name = p_name and c.key = p_key;
    allowed := true; retry_after_sec := 0; return next;
  end $$`,

  `create or replace function kv_get(p_key text)
  returns jsonb
  language sql security definer stable set search_path = public, pg_temp as $$
    select value from kv_store
     where key = p_key and (expires_at is null or expires_at > now());
  $$`,

  // SET with optional NX + TTL. NX succeeds when the key is absent OR expired;
  // the conflicting row's lock makes concurrent NX claims one-winner.
  `create or replace function kv_set(p_key text, p_value jsonb, p_ttl_sec int, p_nx boolean)
  returns boolean
  language plpgsql security definer set search_path = public, pg_temp as $$
  declare
    v_exp timestamptz := case when p_ttl_sec is null then null
                              else now() + make_interval(secs => p_ttl_sec) end;
  begin
    if p_nx then
      insert into kv_store as k (key, value, expires_at)
      values (p_key, p_value, v_exp)
      on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at
        where k.expires_at is not null and k.expires_at <= now();
      return found;
    end if;
    insert into kv_store (key, value, expires_at)
    values (p_key, p_value, v_exp)
    on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at;
    return true;
  end $$`,

  `create or replace function kv_del(p_key text)
  returns void
  language sql security definer set search_path = public, pg_temp as $$
    delete from kv_store where key = p_key;
  $$`,

  // INCRBY with built-in TTL refresh (the Redis call sites always paired
  // INCR/INCRBY with EXPIRE — merged so the refresh can never be lost).
  `create or replace function kv_incrby(p_key text, p_by bigint, p_ttl_sec int)
  returns bigint
  language sql security definer set search_path = public, pg_temp as $$
    insert into kv_store as k (key, value, expires_at)
    values (p_key, to_jsonb(p_by),
            case when p_ttl_sec is null then null else now() + make_interval(secs => p_ttl_sec) end)
    on conflict (key) do update set
      value = to_jsonb(case when k.expires_at is not null and k.expires_at <= now() then p_by
                            else coalesce((k.value #>> '{}')::bigint, 0) + p_by end),
      expires_at = case when p_ttl_sec is null
                        then case when k.expires_at is not null and k.expires_at <= now() then null else k.expires_at end
                        else now() + make_interval(secs => p_ttl_sec) end
    returning (value #>> '{}')::bigint;
  $$`,

  // Trending: each (actor, term) counts at most once per UTC day.
  `create or replace function trend_log(p_term text, p_actor text)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
  declare
    v_day date := (now() at time zone 'utc')::date;
  begin
    if p_actor is not null then
      insert into search_trend_seen (day, actor, term) values (v_day, p_actor, p_term)
      on conflict do nothing;
      if not found then return; end if;
    end if;
    insert into search_trend as t (day, term, count) values (v_day, p_term, 1)
    on conflict (day, term) do update set count = t.count + 1;
  end $$`,

  `create or replace function trend_top(p_days int, p_min int, p_limit int)
  returns table (term text, total bigint)
  language sql security definer stable set search_path = public, pg_temp as $$
    select t.term, sum(t.count)::bigint as total
      from search_trend t
     where t.day >= (now() at time zone 'utc')::date - (p_days - 1)
     group by t.term
    having sum(t.count) >= p_min
     order by total desc
     limit p_limit;
  $$`,

  `create or replace function rl_sweep()
  returns void
  language sql security definer set search_path = public, pg_temp as $$
    delete from kv_store where expires_at is not null and expires_at < now();
    delete from rl_window where expires_at < now();
    delete from rl_cooldown where until < now() and reset_at < now();
    delete from search_trend where day < (now() at time zone 'utc')::date - 3;
    delete from search_trend_seen where day < (now() at time zone 'utc')::date - 1;
    delete from next_cache where expires_at < now();
    delete from next_cache_tag where expires_at < now();
  $$`,

  // Server-side callers only: postgres (Prisma) needs no grant; the forum uses
  // the service key. PostgREST roles must not reach these.
  `revoke execute on function
    rl_check(text, text, int, int),
    rl_cooldown_claim(text, text, int[]),
    kv_get(text), kv_set(text, jsonb, int, boolean), kv_del(text), kv_incrby(text, bigint, int),
    trend_log(text, text), trend_top(int, int, int), rl_sweep()
  from public, anon, authenticated`,
  `grant execute on function
    rl_check(text, text, int, int),
    rl_cooldown_claim(text, text, int[]),
    kv_get(text), kv_set(text, jsonb, int, boolean), kv_del(text), kv_incrby(text, bigint, int),
    trend_log(text, text), trend_top(int, int, int)
  to service_role`,
]

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  // All-or-nothing (review 2026-07-20): a SECURITY DEFINER function in public is
  // PostgREST-callable by anon the moment it exists (default PUBLIC EXECUTE) —
  // an abort between a CREATE and the trailing REVOKE must never strand that
  // window open, so tables + functions + grants commit as ONE transaction.
  await client.query('begin')
  for (const sql of statements) {
    await client.query(sql)
  }
  await client.query('commit')
  // pg_cron stays outside the transaction (background-worker extension).
  await client.query('create extension if not exists pg_cron')
  await client.query(`select cron.schedule('rl-kv-sweep', '*/15 * * * *', 'select rl_sweep()')`)
  console.log(`rate-limit-pg: ${statements.length} statements + pg_cron sweep applied ✓`)
} catch (e) {
  await client.query('rollback').catch(() => {})
  throw e
} finally {
  await client.end()
}
