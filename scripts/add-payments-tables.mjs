// Creates the eno.forum payment tables: "Order", "OrderEvent", "CustodyWallet".
//
// ⛔ WHY THIS IS A SCRIPT AND NOT `prisma db push`. `db:push` is destructive against this database
// — the guard in scripts/db-guard.mjs exists because a push generated 18 DROP TABLEs — and it
// cannot run at all while public.Profile carries a cross-schema FK to Supabase's auth.users. Every
// additive change in this repo is a hand-written idempotent script; see add-convo-delete-cols.mjs.
//
// ⚠️ IDEMPOTENT AND ADDITIVE ONLY. Everything is `if not exists`; nothing here drops, alters a
// type, or touches a row. Running it twice is a no-op, which is what makes it safe to run against
// production without a maintenance window.
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
    if not exists (select 1 from pg_constraint where conname = 'Order_listing_belongs_to_seller') then
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

const { rows } = await client.query(`
  select table_name, (select count(*) from information_schema.columns c where c.table_name = t.table_name) as cols
  from information_schema.tables t
  where table_schema = 'public' and table_name in ('Order','OrderEvent','CustodyWallet')
  order by table_name;
`)
console.log('payment tables:')
for (const r of rows) console.log(`  ${r.table_name} (${r.cols} columns)`)
if (rows.length !== 3) { console.error('expected 3 tables'); process.exitCode = 1 }

await client.end()
