// Creates the eno.forum payment tables: "Order", "OrderEvent", "CustodyWallet".
//
// ⛔ WHY THIS IS A SCRIPT AND NOT `prisma db push`. `db:push` is destructive against this database
// — the guard in scripts/db-guard.mjs exists because a push generated 18 DROP TABLEs — and it
// cannot run at all while public.Profile carries a cross-schema FK to Supabase's auth.users. Every
// additive change in this repo is a hand-written idempotent script; see add-convo-delete-cols.mjs.
//
// ⚠️ RE-RUNNABLE AND CONVERGENT — which is NOT quite "a no-op", and the distinction is a reviewer's.
// Everything creating a table, index or column is `if not exists`, and nothing alters a type or
// touches a row. The ONE exception is the residence CHECK constraint, dropped and re-added so a
// corrected rule can reach a database that already ran an older version of this file; both
// statements are inside the transaction, so the table is never left unprotected.
//
// ⚠️ IT TAKES LOCKS ON LIVE TABLES — see the lock_timeout note before running it under load.
//
// ⚠️ THE TYPES MIRROR prisma/schema.prisma EXACTLY. `amount` is BIGINT minor units — int4 overflows
// at $2 147 once USDC's six decimals are counted — ids are text cuid, and the two Profile references are uuid because Profile.id is
// auth.users.id. If the schema and this file ever disagree, Prisma will read columns that are not
// there and fail at runtime rather than at deploy.
//
//   set -a; . ./.env; set +a; node scripts/add-payments-tables.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

/**
 * ⛔ ONE TRANSACTION, SO A FAILURE LEAVES NOTHING HALF-APPLIED. Postgres has transactional DDL and
 * this script did not use it: the first version named the Prisma MODEL instead of the mapped table
 * in its final ALTER, which would have aborted after three tables and six indexes were already
 * committed. Every statement here is `if not exists`, so a re-run converges either way — but
 * "converges on the second try" is a worse guarantee than "never lands partially", and the flow
 * CLAUDE.md documents for schema changes is explicitly BEGIN/COMMIT with ON_ERROR_STOP.
 */
/**
 * ⛔ A THROW MUST ROLL BACK AND CLOSE, NOT JUST EXIT. A reviewer pointed out the whole body ran
 * outside any error handling: a failing statement left an open transaction and an open connection,
 * and while process exit tidies both in practice, "in practice" is not what you want holding a lock
 * on a production table. The rollback is explicit and the disconnect is in `finally`.
 */
try {
  await client.query('begin')

  /**
   * ⛔ FAIL FAST RATHER THAN QUEUE, BECAUSE THE TRANSACTION MADE THE LOCKS WORSE. A reviewer traced
   * what wrapping this in one transaction actually costs: `create unique index` on `Listing` takes a
   * SHARE lock now held until COMMIT instead of until the statement ends, and the two
   * `alter table identity_verifications` statements need ACCESS EXCLUSIVE — which queues behind any
   * open read of that table AND, while queued, blocks every new KYC write behind it. A migration
   * that waits is how a "safe, additive" script takes the site down.
   * ⚠️ 5s TO ACQUIRE, 60s TO RUN. Losing the lock race aborts the transaction and changes nothing;
   * the script is re-runnable, so retrying in a quiet moment costs nothing and blocking production
   * costs a great deal.
   */
  await client.query("set local lock_timeout = '5s'")
  await client.query("set local statement_timeout = '60s'")

  // ⛔ RESTRICT, NEVER CASCADE, ON ALL THREE ORDER FKs. An order is a financial record: deleting an
  // account, a shop or a listing must not delete the evidence that money moved. Erasure redacts the
  // PII in place and leaves the row.
  await client.query(`
    create table if not exists public."Order" (
      "id"         text primary key,
      "buyerId"    uuid not null references public."Profile"("id") on delete restrict,
      "sellerId"   text not null references public."Seller"("id")  on delete restrict,
      "listingId"  text not null references public."Listing"("id") on delete restrict,
      "status"     text not null default 'pending',
      "rail"       text,
      "amount"     bigint not null,
      "currency"   text not null default 'USD',
      "railRef"    text,
      "createdAt"  timestamp(3) not null default now(),
      "updatedAt"  timestamp(3) not null default now(),
      "paidAt"     timestamp(3)
    );
  `)

  // ⚠️ THE UNIQUE ON railRef STOPS ONE RAIL PAYMENT BEING RECORDED AGAINST TWO ORDERS. It does NOT,
  // on its own, settle a race between two deliveries for the SAME order — a reviewer pointed out that
  // both writing the same ref to the same row violates nothing. That race is closed in the caller, by
  // making the settlement a conditional update (`where "status" = 'awaiting_payment'`) and acting only
  // when it changed a row. Both guards are needed and they cover different collisions.
  await client.query(`create unique index if not exists "Order_railRef_key" on public."Order" ("railRef");`)

  /**
   * ⛔ THE PAYMENT REFERENCE — the entire link between a bank transfer and an order. A VietQR
   * buyer's banking app carries it as the memo and SePay reads it back off the statement; nothing
   * else connects the two. See lib/payments/reference.ts.
   * ⚠️ ADDED NULLABLE THEN MADE UNIQUE, because `Order` may already exist from an earlier run of
   * this script and a NOT NULL column cannot be added to a table with rows and no default. It is
   * empty today (0 orders), so the application can treat it as required; the database is stated
   * honestly as "unique when present" rather than lying about a constraint it cannot enforce
   * retroactively.
   */
  await client.query(`alter table public."Order" add column if not exists "reference" text;`)
  await client.query(`create unique index if not exists "Order_reference_key" on public."Order" ("reference");`)

  /**
   * ⛔ MADE NOT NULL ONCE IT SAFELY CAN BE, because Prisma DECLARES IT REQUIRED and a nullable column
   * underneath is the two layers disagreeing — a reviewer's point. A writer bypassing Prisma could
   * insert a reference-less order that no payment could ever match, and Prisma would then read a
   * null into a field typed `string`.
   * ⚠️ GUARDED ON EMPTINESS, like the drop above. A table with reference-less rows cannot take the
   * constraint, and inventing references for existing orders is not something a migration should do
   * silently — it stops and says so instead.
   */
  const { rows: refless } = await client.query(`select count(*)::int as n from public."Order" where "reference" is null;`)
  if (refless[0].n === 0) {
    await client.query(`alter table public."Order" alter column "reference" set not null;`)
  } else {
    console.error(`Order.reference left nullable: ${refless[0].n} rows have none. Backfill before the schema can promise it.`)
    process.exitCode = 1
  }

  /**
   * ⛔ THE LISTING MUST BELONG TO THE SELLER BEING PAID, AND ONLY THE DATABASE CAN GUARANTEE THAT.
   * `sellerId` and `listingId` were two independent foreign keys, so nothing stopped an order that
   * DISPLAYS Seller A's listing from SETTLING to Seller B — a reviewer walked straight to it. A
   * composite FK on (listingId, sellerId) referencing Listing(id, sellerId) makes the pairing an
   * integrity constraint rather than something every caller has to remember to check.
   *
   * ⚠️ THE REFERENCED PAIR NEEDS ITS OWN UNIQUE INDEX — Postgres will only accept a composite FK
   * against a unique key. `Listing.id` is already unique, so (id, sellerId) is trivially unique too;
   * the index exists solely to let the FK be declared.
   * ⚠️ NOT EXPRESSIBLE IN prisma/schema.prisma, which is why it lives here and why the schema carries
   * a pointer to this file. Prisma has no multi-column relation to a non-primary unique key of this
   * shape, so losing this script would silently lose the constraint.
   */
  await client.query(`create unique index if not exists "Listing_id_sellerId_key" on public."Listing" ("id", "sellerId");`)
  await client.query(`
    do $$
    begin
      -- ⚠️ SCOPED BY conrelid. A constraint name is unique per TABLE in Postgres, not per database, so
      -- a same-named constraint on any other table made this guard skip the creation while the check
      -- at the bottom still counted it as present. Two reviewers found it.
      if not exists (select 1 from pg_constraint
                     where conname = 'Order_listing_belongs_to_seller'
                       and conrelid = 'public."Order"'::regclass) then
        alter table public."Order"
          add constraint "Order_listing_belongs_to_seller"
          foreign key ("listingId", "sellerId")
          references public."Listing" ("id", "sellerId")
          on delete restrict;
      end if;
    end $$;
  `)
  await client.query(`create index if not exists "Order_buyerId_createdAt_idx"  on public."Order" ("buyerId", "createdAt");`)
  await client.query(`create index if not exists "Order_sellerId_createdAt_idx" on public."Order" ("sellerId", "createdAt");`)
  await client.query(`create index if not exists "Order_status_idx"             on public."Order" ("status");`)

  // Append-only audit. CASCADE here is right and the opposite of the Order FKs: an event has no
  // meaning without its order, and orders are never deleted anyway.
  await client.query(`
    create table if not exists public."OrderEvent" (
      "id"         text primary key,
      "orderId"    text not null references public."Order"("id") on delete cascade,
      "type"       text not null,
      "fromStatus" text not null,
      "toStatus"   text not null,
      "actorId"    uuid,
      "metaJson"   text,
      "createdAt"  timestamp(3) not null default now()
    );
  `)
  await client.query(`create index if not exists "OrderEvent_orderId_createdAt_idx" on public."OrderEvent" ("orderId", "createdAt");`)

  // ⚠️ THE ADDRESS, NEVER A KEY. The signer lives at Crossmint (a server signer the user authorises
  // once); this row is a pointer so we can read a balance and address a transfer.
  //
  // ⚠️ ONE WALLET PER PROFILE IS DELIBERATE, mirroring `profileId @unique` in schema.prisma. Two
  // reviewers read the `(provider, chain, address)` key as intending several wallets per person; it
  // does not. That key exists so the SAME address on `base` and `base-sepolia` cannot collide — a
  // staging wallet masquerading as a production one. If multi-chain custody is ever wanted, the
  // `profileId` unique is what must change, in the Prisma schema first.
  await client.query(`
    create table if not exists public."CustodyWallet" (
      "id"        text primary key,
      "profileId" uuid not null unique references public."Profile"("id") on delete cascade,
      "provider"  text not null default 'crossmint',
      "chain"     text not null,
      "address"   text not null,
      "createdAt" timestamp(3) not null default now()
    );
  `)
  // ⚠️ (provider, CHAIN, address). The same address exists on `base` and `base-sepolia`, so a key
  // without the chain is precisely what would let a staging wallet collide with a production one.
  await client.query(`create unique index if not exists "CustodyWallet_provider_chain_address_key" on public."CustodyWallet" ("provider", "chain", "address");`)
  await client.query(`create index if not exists "CustodyWallet_profileId_idx" on public."CustodyWallet" ("profileId");`)

  /**
   * ⛔ RESIDENCE ON THE IDENTITY RECORD, AND WITHOUT IT THE WALLET CAN NEVER BE PROVISIONED FOR
   * ANYONE. The settlement rules turn on where a person LIVES, and the only thing the app could
   * derive from a document was Vietnamese residence or nothing — both of which read as Vietnamese, so
   * every user was ineligible. This column is where a source that actually verified an address puts
   * its answer (the payment provider's own KYC; they run it natively and are the regulated party).
   * ⛔ AND `residenceSource` IS WHY THE COUNTRY CAN BE TRUSTED. The country alone is just a column,
   * and the first thing to write it — a form field, a CSV backfill, a hopeful admin — would silently
   * become the rule deciding who may hold a stablecoin wallet. identity.ts honours the country ONLY
   * when this names an address-verifying source, so the two columns must always be written together.
   * ⚠️ NULLABLE AND UNPOPULATED IS THE SAFE STATE: unknown residence is treated as Vietnam.
   */
  // ⚠️ `identity_verifications`, NOT `IdentityVerification`. This model is one of the few carrying an
  // `@@map`, so the Prisma model name and the real table name differ — and raw SQL, unlike the client,
  // does not do that translation for you. The first version named the model, which meant this ALTER
  // would have failed with 42P01 AFTER the three tables above had already been created, leaving a
  // half-applied migration behind. Only the TABLE is mapped; the columns stay camelCase.
  await client.query(`
    alter table public."identity_verifications"
      add column if not exists "residenceCountry" char(3),
      add column if not exists "residenceSource" text;
  `)

  /**
   * ⛔ THE TWO RESIDENCE COLUMNS ARE NOW A DATABASE INVARIANT, NOT A COMMENT ASKING NICELY. The note
   * above says they "must always be written together"; a reviewer pointed out nothing enforced it, so
   * any partial write — a backfill, a manual UPDATE, a future adapter — could leave a country with no
   * provenance. identity.ts would ignore such a row (it demands an address-verifying source), so the
   * failure is a silently unprovisioned user rather than an unlawful wallet; the constraint makes the
   * bad state unrepresentable instead of merely unread.
   * ⚠️ A SOURCE WITHOUT A COUNTRY IS FINE — that is a provider that answered "I could not establish
   * one". It is the country without provenance that must not exist.
   */
  /**
   * ⚠️ DROP-THEN-ADD, THE ONE PLACE THIS SCRIPT IS NOT PURELY ADDITIVE, AND DELIBERATELY SO. The
   * constraint is owned by this script and nothing else creates it; an `if not exists` guard would
   * pin the FIRST definition forever, so a corrected rule — as happened here, when `is not null`
   * turned out to accept an empty string — could never take effect on a database that already ran it.
   * Both statements are inside the transaction, so there is no window where the table is unprotected.
   */
  await client.query(`
    alter table public."identity_verifications"
      drop constraint if exists "identity_verifications_residence_provenance";
  `)
  await client.query(`
    alter table public."identity_verifications"
      add constraint "identity_verifications_residence_provenance"
      check ("residenceCountry" is null or ("residenceSource" is not null and "residenceSource" <> ''));
  `)

  /**
   * ⛔ WHERE A VIETNAMESE BUYER'S MONEY LANDS. Owner, 2026-08-31: *"vietnam is the place users will
   * pay with qr"*. A VietQR code is a NAPAS 247 transfer to this account, and lib/payments/vietqr.ts
   * refuses to render one without all three — a QR pointing at nothing is worse than no QR.
   * ⚠️ SEPARATE FROM `bankNameSeen`, which is a reviewer's audit note about a verification document.
   * That is evidence about a past check; these are live payment instructions.
   * ⚠️ WIDTHS MATCH THE FORMAT: a NAPAS acquirer BIN is exactly 6 digits and Vietnamese account
   * numbers do not exceed 19. Anything longer is a data error, not a long account.
   */
  await client.query(`
    create table if not exists public."seller_payout" (
      "sellerId"        text primary key references public."Seller"("id") on delete cascade,
      "bankBin"         varchar(6)  not null,
      "bankAccountNo"   varchar(19) not null,
      "bankAccountName" text        not null,
      "updatedAt"       timestamp(3) not null default now()
    );
  `)

  /**
   * ⛔ THE THREE COLUMNS THIS REPLACES ARE DROPPED — THE ONE DESTRUCTIVE STATEMENT IN THIS FILE, AND
   * IT IS GUARDED. They were added by an earlier run of this same script, hours old, and nothing has
   * ever written them: the payout details moved to their own table because `Seller` is the
   * most-queried model in the app and ~16 of its queries have no explicit `select`, so an account
   * number on it is one `{...seller}` away from a public response forever.
   * ⚠️ THE GUARD IS NOT DECORATION. It counts non-null values first and refuses to drop if any exist,
   * so if this ever runs somewhere the columns WERE populated it stops rather than deleting payment
   * details. CLAUDE.md's rule about DROP exists because a generated migration emitted eighteen of
   * them; this is one, named, and it proves its target is empty before it fires.
   */
  const { rows: held } = await client.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'Seller'
      and column_name in ('bankBin','bankAccountNo','bankAccountName');
  `)
  if (held.length > 0) {
    /**
     * ⛔ THE LOCK IS TAKEN BEFORE THE COUNT, NOT AFTER. Two reviewers found the race: the guard
     * counted non-null values and then dropped, so a write from the running application in between
     * would be destroyed by a check that had already passed. `ALTER TABLE` takes ACCESS EXCLUSIVE
     * anyway — taking it first simply means nothing can slip into the window. `lock_timeout` is
     * already 5s for this transaction, so a busy table aborts rather than blocking the site.
     */
    await client.query('lock table public."Seller" in access exclusive mode')

    /**
     * ⛔ BUILT FROM THE COLUMNS THAT ACTUALLY EXIST. The first version named all three in the
     * emptiness check while only asserting that AT LEAST ONE existed — so a partially-applied
     * schema (one column added, the run interrupted) crashed with 42703 on the very query meant to
     * make the drop safe. Both reviewers found the same state, and it is exactly the one a failed
     * earlier run leaves behind.
     */
    const cols = held.map((r) => r.column_name)
    const anyNotNull = cols.map((c) => `"${c}" is not null`).join(' or ')
    const { rows: populated } = await client.query(`
      select count(*)::int as n from public."Seller" where ${anyNotNull};
    `)
    if (populated[0].n > 0) {
      console.error(`REFUSING to drop Seller bank columns: ${populated[0].n} rows hold values. Migrate them into seller_payout first.`)
      process.exitCode = 1
    } else {
      await client.query(`
        alter table public."Seller"
          drop column if exists "bankBin",
          drop column if exists "bankAccountNo",
          drop column if exists "bankAccountName";
      `)
      console.log(`moved Seller bank columns -> seller_payout (${cols.join(', ')} were empty)`)
    }
  }

  const { rows } = await client.query(`
    select table_name, (select count(*) from information_schema.columns c where c.table_name = t.table_name) as cols
    from information_schema.tables t
    where table_schema = 'public' and table_name in ('Order','OrderEvent','CustodyWallet')
    order by table_name;
  `)
  console.log('payment tables:')
  for (const r of rows) console.log(`  ${r.table_name} (${r.cols} columns)`)
  if (rows.length !== 3) { console.error('expected 3 tables'); process.exitCode = 1 }

  // ⚠️ THE COLUMNS ARE VERIFIED TOO, not just the tables. `add column if not exists` is silent on
  // success and on no-op alike, so a run that did nothing looks exactly like a run that worked.
  const { rows: bank } = await client.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'seller_payout';
  `)
  console.log(`seller_payout columns: ${bank.map((c) => c.column_name).sort().join(', ') || '(none)'}`)
  if (bank.length !== 5) { console.error('expected 5 seller_payout columns'); process.exitCode = 1 }

  const { rows: cols } = await client.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'identity_verifications'
      and column_name in ('residenceCountry','residenceSource');
  `)
  console.log(`IdentityVerification residence columns: ${cols.map((c) => c.column_name).sort().join(', ') || '(none)'}`)
  if (cols.length !== 2) { console.error('expected residenceCountry + residenceSource'); process.exitCode = 1 }

  // ⚠️ SCOPED BY TABLE HERE TOO — otherwise a same-named constraint elsewhere lets this assertion
  // report success over an unprotected table, which is worse than having no assertion.
  const { rows: chk } = await client.query(`
    select conname from pg_constraint
    where (conname = 'Order_listing_belongs_to_seller' and conrelid = 'public."Order"'::regclass)
       or (conname = 'identity_verifications_residence_provenance'
           and conrelid = 'public."identity_verifications"'::regclass);
  `)
  console.log(`integrity constraints: ${chk.map((c) => c.conname).sort().join(', ') || '(none)'}`)
  if (chk.length !== 2) { console.error('expected both integrity constraints'); process.exitCode = 1 }

  /**
   * ⛔ AND THE MONEY-CRITICAL OBJECTS ARE CHECKED BY DEFINITION, NOT BY NAME. `create ... if not
   * exists` matches on the NAME only, so a pre-existing `Order_railRef_key` that is not unique, or
   * a composite FK pointing at different columns, is silently accepted and every assertion above
   * still passes. A reviewer put it exactly right: the script would commit while advertising an
   * invariant it had not established. These two are checked because they are the ones that hold
   * money — one rail payment against two orders, and paying the wrong seller for a listing.
   * ⚠️ NOT A FULL SCHEMA DIFF, and deliberately not: verifying every column and FK here would be a
   * second, drifting copy of prisma/schema.prisma. Prisma is the check for the rest — it fails at
   * runtime on a column that is not there.
   */
  const { rows: shape } = await client.query(`
    select
      (select indisunique from pg_index
        where indexrelid = 'public."Order_railRef_key"'::regclass) as railref_unique,
      (select pg_get_constraintdef(oid) from pg_constraint
        where conname = 'Order_listing_belongs_to_seller'
          and conrelid = 'public."Order"'::regclass) as listing_fk;
  `)
  const railRefUnique = shape[0]?.railref_unique === true
  const fkDef = String(shape[0]?.listing_fk ?? '')
  const fkCorrect = /\("listingId", "sellerId"\)/.test(fkDef) && /REFERENCES "Listing"\(id, "sellerId"\)/.test(fkDef)
  console.log(`Order_railRef_key unique: ${railRefUnique} | listing→seller FK targets the right pair: ${fkCorrect}`)
  if (!railRefUnique || !fkCorrect) {
    console.error('a money-critical object exists under the right name with the wrong definition')
    process.exitCode = 1
  }

  /**
   * ⛔ ROW-LEVEL SECURITY ON EVERY PAYMENTS TABLE — THE ORIGINAL OMISSION, FOUND BY A LIVE PENTEST
   * 2026-09-01. These tables were created without RLS while the rest of the schema has it on, and
   * self-hosted Supabase exposes PostgREST at sb.eno.vn/rest/v1 to the public anon key: RLS-off +
   * the anon SELECT grant meant ANYONE could read `seller_payout` (bank account numbers), `Order`
   * and `CustodyWallet` over the internet. Confirmed live — the anon key dumped a real bank row.
   * ENABLE + FORCE (deny-all: no policies exist, so anon/authenticated get zero rows) matches how
   * Listing/Message/Seller are already protected. The app is UNAFFECTED — it reads these only via
   * Prisma on the direct service connection, which bypasses RLS; nothing reads them via supabase-js.
   */
  for (const t of ['Order', 'OrderEvent', 'CustodyWallet', 'seller_payout']) {
    await client.query(`alter table public."${t}" enable row level security;`)
    await client.query(`alter table public."${t}" force row level security;`)
  }
  const { rows: rls } = await client.query(`
    select c.relname, c.relrowsecurity as on, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('Order','OrderEvent','CustodyWallet','seller_payout');
  `)
  // ⚠️ BOTH `on` AND `forced` — the script runs `force` too, so the assertion must check it, or a
  // future edit dropping the force line (which closes the owner-bypass) still passes green.
  const rlsOff = rls.filter((r) => r.on !== true || r.forced !== true).map((r) => r.relname)
  console.log(`RLS enabled+forced on payments tables: ${rls.filter((r) => r.on === true && r.forced === true).map((r) => r.relname).sort().join(', ') || '(none)'}`)
  if (rls.length !== 4 || rlsOff.length) {
    console.error(`RLS missing on: ${rlsOff.join(', ') || '(a table is absent)'} — refusing to commit a payments schema that leaks to anon`)
    process.exitCode = 1
  }

  // ⛔ COMMIT ONLY IF EVERY ASSERTION PASSED. A verification that reports a problem and then commits
  // anyway is not a verification.
  if (process.exitCode) { console.error('rolling back — assertions failed'); await client.query('rollback') }
  else { await client.query('commit') }
} catch (e) {
  console.error('FAILED, rolling back:', e instanceof Error ? e.message : e)
  try { await client.query('rollback') } catch { /* the connection may already be gone */ }
  process.exitCode = 1
} finally {
  await client.end()
}

