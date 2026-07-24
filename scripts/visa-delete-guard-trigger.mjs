// BEFORE DELETE guard on visa_applications: refuse to hard-delete a case that still has a PAID
// visa_payments row. `visa_payments.application_id` is ON DELETE CASCADE (scripts/visa-payment-
// setup.mjs), so without this a hard delete would DESTROY a captured payment's financial record.
//
// Why a trigger and not FK → RESTRICT: a plain RESTRICT would also block deleting a legitimate
// UNPAID draft that carries an abandoned checkout row (visa_payments status='created'). This trigger
// keys off status='paid' ONLY, so unpaid rows still cascade harmlessly while paid ones are protected.
//
// Why it matters beyond the app-level guard in the DELETE route: the trigger fires INSIDE the delete
// transaction, so it also closes the TOCTOU where a payment commits between the route's paid-row
// pre-check and the actual delete (codex, 2026-07-24 diff review). App-level checks alone can only
// narrow that window; this closes it atomically at the source.
//
// Additive + idempotent (create-or-replace + drop-if-exists). Purely defensive — it can only REFUSE
// a delete that would have destroyed money history; it never changes any other path.
//
// Run:  set -a; . ./.env; set +a; node scripts/visa-delete-guard-trigger.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

const stmts = [
  `create or replace function public.visa_block_delete_with_paid_payment() returns trigger
     language plpgsql as $$
     begin
       -- Refuse to delete an application that has a PAID payment row — from ANY path (the handler,
       -- an admin script, a stray query), which is the defense-in-depth this trigger buys over the
       -- app-level checks. It also catches the partial-failure window where visa_payments is already
       -- 'paid' but the app's denormalized paid_at is still null.
       --
       -- WARNING: NOT fully atomic against a payment being CAPTURED at the same instant the draft
       -- is deleted (an existing created row flipping to paid concurrently): under READ COMMITTED
       -- this EXISTS uses the delete statement snapshot. A FOR UPDATE lock here WOULD close that,
       -- but it deadlocks against the capture path — Postgres locks the visa_applications row BEFORE
       -- firing this BEFORE-DELETE trigger, so the delete locks app-then-payments while capture locks
       -- payments-then-app, and the deadlock victim could be the CAPTURE tx (money taken, no DB record) —
       -- strictly worse than the race. The durable, deadlock-free fix belongs in the CAPTURE path
       -- (markVisaPaidAndHandoff, src/lib/visa/payments.ts): lock the visa_applications row FIRST
       -- there too (or refuse to mark paid once the application is gone), so both paths order
       -- app→payments. Tracked as a follow-up for the payments owner (codex+Gemini, 2026-07-24).
       if exists (
         select 1 from public.visa_payments p
         where p.application_id = old.id and p.status = 'paid'
       ) then
         raise exception 'visa_application_has_paid_payment'
           using errcode = 'restrict_violation';
       end if;
       return old;
     end;
     $$;`,
  `drop trigger if exists visa_block_delete_with_paid_payment on public.visa_applications;`,
  `create trigger visa_block_delete_with_paid_payment
     before delete on public.visa_applications
     for each row execute function public.visa_block_delete_with_paid_payment();`,
]

for (const sql of stmts) {
  await client.query(sql)
  console.log('ok:', sql.trim().split('\n')[0])
}

const { rows } = await client.query(
  `select tgname, tgenabled from pg_trigger
    where tgname = 'visa_block_delete_with_paid_payment' and not tgisinternal`,
)
console.log('trigger present:', rows.length === 1, rows)

await client.end()
