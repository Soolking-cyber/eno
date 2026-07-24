// The deadlock-free half of the capture-vs-delete race (the follow-up the delete-guard trigger
// documents — scripts/visa-delete-guard-trigger.mjs). markVisaPaidAndHandoff used to flip a
// visa_payments row 'created'→'paid' WITHOUT holding the visa_applications row, so its lock order
// was payments→app while the DELETE path is app→payments — a deadlock hazard AND a READ-COMMITTED
// TOCTOU where a payment committing 'paid' inside a delete's snapshot window is missed by the
// delete trigger's EXISTS → the delete cascades → the just-captured payment record is destroyed.
//
// This function is the capture side's atomic core. It (1) locks the visa_applications row FIRST —
// the same order the delete takes — then (2) flips the payment and (3) STAMPS the application in the
// SAME transaction. The stamp matters as much as the lock: a bare FOR UPDATE does not guarantee the
// blocked delete re-fires its BEFORE trigger with fresh visibility, but MODIFYING the app row forces
// Postgres's EvalPlanQual re-check, so the resumed delete re-evaluates the modified row, re-fires the
// trigger, and sees the committed 'paid' → blocked (codex, 2026-07-24). A delete that already
// committed leaves no app row → the FOR UPDATE returns 'app_gone' and nothing is flipped (fail safe).
//
// ⚠️ SECURITY: this must never be callable by an end user over PostgREST — that would let a client
// flip their own payment to 'paid' with a self-chosen amount. EXECUTE is revoked from
// public/anon/authenticated and granted ONLY to service_role (the key getVisaDb uses).
//
// Run:  set -a; . ./.env; set +a; node scripts/visa-capture-payment-fn.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

// ⚠️ The ARG LIST CHANGED (2026-07-24): p_actor_ref was added so the dispute-trail event can be
// written INSIDE this transaction. Adding a parameter creates an OVERLOAD rather than replacing
// the function, and PostgREST would then have two candidates to resolve between — so the OLD
// signature is dropped explicitly in the same transaction as the new one is created.
const SIG = 'public.visa_capture_payment(uuid, text, text, integer, text, timestamptz, text, boolean)'

const stmts = [
  // ⚠️ DROP EVERY EXISTING OVERLOAD FIRST, by introspection rather than by a hardcoded list.
  // Each time this function gained a parameter, `create or replace` produced a NEW overload
  // beside the old one instead of replacing it — and once two of them have defaults, a call
  // that omits an argument matches both and Postgres refuses it outright:
  //   "function visa_capture_payment(...) is not unique"
  // which is a BROKEN CAPTURE, not a warning. Dropping by name inside this same transaction
  // guarantees exactly one signature exists at commit, whatever the history was.
  `do $drop$
   declare r record;
   begin
     for r in
       select p.oid::regprocedure as sig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'visa_capture_payment'
     loop
       execute format('drop function if exists %s', r.sig);
     end loop;
   end
   $drop$;`,

  `create or replace function public.visa_capture_payment(
     p_app_id uuid,
     p_provider text,
     p_provider_ref text,
     p_amount_cents integer,
     p_currency text,
     p_now timestamptz,
     -- ⚠️ DEFAULT NULL is a DEPLOYMENT-ORDER guard, not laziness. The DDL is applied by hand and
     -- the code ships on a later push, so there is always a window where one side is older than
     -- the other. With a default, the 6-argument call the CURRENTLY DEPLOYED code makes still
     -- resolves to this function (PostgREST matches by name and allows omitted defaults), and the
     -- 7-argument call the new code makes resolves to it too. Neither order breaks a capture.
     p_actor_ref text default null,
     -- ⚠️ WHO WRITES THE AUDIT ROW, and why this is a parameter rather than always-on. The DDL
     -- lands before the code does, so for a few minutes the CURRENTLY DEPLOYED (old) caller is
     -- still doing its own recordVisaEvent after this returns. If the function also wrote one,
     -- a capture in that window would produce TWO payment_recorded rows for one payment (codex).
     -- Defaulting to FALSE means the old 6-argument call keeps its old behaviour exactly, and
     -- only the new caller — which no longer writes its own — asks the function to do it.
     -- Once the new code is everywhere this stays true forever; the default is what makes the
     -- transition safe, not a permanent opt-out.
     p_write_event boolean default false
   ) returns text
   language plpgsql
   volatile
   security invoker
   set search_path = public
   as $$
   declare
     v_flipped integer;
     v_paid_exists boolean;
     v_app_was_unstamped boolean;
     v_checkout_amount_cents integer;
   begin
     -- (1) Lock the application row FIRST — matches the DELETE path's app→payments order, so the two
     -- can never deadlock. Fail closed if the draft was already deleted. Capture whether the case was
     -- not yet stamped paid, so the caller can record the completion event exactly once (below).
     select (paid_at is null) into v_app_was_unstamped
       from public.visa_applications
      where id = p_app_id
      for update;
     if not found then
       return 'app_gone';
     end if;

     -- (1b) The checkout-time amount, read BEFORE step 2 overwrites amount_cents with the
     -- captured figure. The dispute trail wants BOTH numbers: what the applicant was quoted at
     -- checkout, and what the provider actually captured.
     -- ORDERED, not a bare limit 1: nothing constrains (application_id, provider, provider_ref)
     -- to one row, so an unordered pick would be nondeterministic (codex). Prefer the row step 2
     -- is about to flip — that is the one whose amount_cents is the checkout QUOTE, before the
     -- captured figure overwrites it. A legacy-partial case has only the already-paid row, which
     -- is then the honest best available. No row at all leaves NULL, written as JSON null.
     select amount_cents into v_checkout_amount_cents
       from public.visa_payments
      where application_id = p_app_id
        and provider = p_provider
        and provider_ref = p_provider_ref
      order by (status = 'created') desc, created_at desc
      limit 1;

     -- (2) Flip THIS application's checkout row created→paid, at most once. Binding application_id
     -- (not only provider/ref) keeps the locked application and the paid payment the SAME case — a
     -- leaked/duplicated ref for another case can never be paid against this locked row.
     update public.visa_payments
        set status = 'paid', paid_at = p_now, amount_cents = p_amount_cents, currency = p_currency
      where application_id = p_app_id
        and provider = p_provider
        and provider_ref = p_provider_ref
        and status = 'created';
     get diagnostics v_flipped = row_count;

     -- (3) CLASSIFY BEFORE STAMPING. If nothing flipped, only a genuine already-paid replay for THIS
     -- case may continue; anything else (missing / wrong status / cross-case) RAISES so the WHOLE
     -- transaction rolls back — the application must never be stamped 'paid' off a shaky payment.
     -- (codex, 2026-07-24: the earlier order stamped paid_at THEN let the caller throw, which could
     -- not undo the already-committed stamp.)
     if v_flipped = 0 then
       select exists (
         select 1 from public.visa_payments
          where application_id = p_app_id
            and provider = p_provider
            and provider_ref = p_provider_ref
            and status = 'paid'
       ) into v_paid_exists;
       if not v_paid_exists then
         raise exception 'visa_capture_unexpected' using errcode = 'P0001';
       end if;
     end if;

     -- (4) Stamp the application — reached ONLY for a fresh flip or a verified replay. MODIFYING the
     -- row (not just locking it) is what forces a concurrent DELETE, blocked on our lock, to
     -- re-evaluate the changed row via EvalPlanQual and re-fire its BEFORE trigger against the
     -- now-committed 'paid'. Idempotent by coalesce: a replay keeps the original paid_at.
     update public.visa_applications
        set paid_at = coalesce(paid_at, p_now),
            payment_provider = coalesce(payment_provider, p_provider),
            payment_ref = coalesce(payment_ref, p_provider_ref),
            updated_at = p_now
      where id = p_app_id;

     -- (5) THE DISPUTE-TRAIL EVENT, IN THIS TRANSACTION. It used to be written by the caller
     -- after the RPC returned, which left a window: a crash in the ~ms between this commit and
     -- that write lost the row for good, because a replay returns 'already_paid' and skipped it.
     -- Both external reviewers independently said the same thing — a self-heal on replay only
     -- NARROWS the window, since recovery depends on a replay that may never come — so the write
     -- moved in here, where it either commits with the money or rolls back with it.
     -- Written only when this call ADVANCED the capture -- exactly the old stampedNow condition
     -- in the caller -- so a replay still writes nothing and no duplicate can appear.
     -- This is the JOIN KEY of the trail: 'checkout_started', written earlier under the SAME
     -- (provider, providerRef), carries which listing was picked and at what price.
     if p_write_event and (v_flipped > 0 or v_app_was_unstamped) then
       insert into public.visa_events (id, application_id, actor_type, actor_ref, event, metadata)
       values (
         gen_random_uuid(), p_app_id, 'system', p_actor_ref, 'payment_recorded',
         jsonb_build_object(
           'provider', p_provider,
           'providerRef', p_provider_ref,
           'amountCents', p_amount_cents,
           'chargedAmountCents', p_amount_cents,
           'checkoutAmountCents', v_checkout_amount_cents,
           'currency', p_currency
         )
       );
     end if;

     -- 'flipped' whenever THIS call ADVANCED the capture — either the payment freshly flipped
     -- created→paid, OR the case was not yet stamped and is now (a legacy partial state from the old
     -- two-write flow: payment already paid, app paid_at still null). The caller records the
     -- payment_recorded completion event exactly on 'flipped'. Only a fully-settled replay (payment
     -- paid AND app already stamped) returns 'already_paid' (codex, 2026-07-24).
     return case when (v_flipped > 0 or v_app_was_unstamped) then 'flipped' else 'already_paid' end;
   end
   $$;`,

  // ⚠️ Lock down execution: never end-user callable over PostgREST.
  `revoke all on function ${SIG} from public;`,
  `revoke all on function ${SIG} from anon;`,
  `revoke all on function ${SIG} from authenticated;`,
  `grant execute on function ${SIG} to service_role;`,
]

// ⚠️ ONE transaction for CREATE + REVOKE + GRANT: a bare CREATE FUNCTION grants EXECUTE to PUBLIC
// by default, so applying the REVOKEs in separate transactions would leave a window where an
// end-user could call the capture function over PostgREST (codex, 2026-07-24). Wrapped, no other
// session sees the function until it is already locked down.
await client.query('begin')
try {
  for (const sql of stmts) {
    await client.query(sql)
    console.log('ok:', sql.split('\n')[0].slice(0, 72))
  }
  await client.query('commit')
} catch (e) {
  await client.query('rollback')
  throw e
}

// Prove it exists + is locked down.
const check = await client.query(
  `select p.proname,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed_can_exec,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_exec,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_exec
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'visa_capture_payment'`,
)
console.log('verify:', check.rows[0])
if (check.rows[0]?.authed_can_exec || check.rows[0]?.anon_can_exec) {
  console.error('⛔ SECURITY: end-user roles can execute the capture function — aborting')
  process.exit(1)
}
if (!check.rows[0]?.service_can_exec) {
  console.error('⛔ service_role cannot execute the capture function — the app would break')
  process.exit(1)
}
console.log('✓ visa_capture_payment installed, service_role-only')

await client.end()
