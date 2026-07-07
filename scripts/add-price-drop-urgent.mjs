// Price-drop + urgent-sale feature (2026-07-07) — idempotent mirror of the Supabase
// migration `price_drop_and_urgent_sale`, for fresh DBs / resets. Adds the
// server-computed drop-badge fields + urgentUntil to Listing and the append-only
// PriceChange audit table (reference-price computation + proof trail).
// Run with the DIRECT connection:
//   set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/add-price-drop-urgent.mjs
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

await client.query(`
  ALTER TABLE public."Listing"
    ADD COLUMN IF NOT EXISTS "previousPrice" double precision,
    ADD COLUMN IF NOT EXISTS "priceDropAt" timestamp(3),
    ADD COLUMN IF NOT EXISTS "lowestNotifiedPrice" double precision,
    ADD COLUMN IF NOT EXISTS "priceDropNotifiedAt" timestamp(3),
    ADD COLUMN IF NOT EXISTS "urgentUntil" timestamp(3);
`)
await client.query(`
  CREATE TABLE IF NOT EXISTS public."PriceChange" (
    "id" text NOT NULL,
    "listingId" text NOT NULL,
    "oldPrice" double precision NOT NULL,
    "newPrice" double precision NOT NULL,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PriceChange_listingId_fkey" FOREIGN KEY ("listingId")
      REFERENCES public."Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
`)
await client.query(`
  CREATE INDEX IF NOT EXISTS "PriceChange_listingId_createdAt_idx"
    ON public."PriceChange"("listingId", "createdAt");
`)
console.log('price-drop + urgent-sale columns and PriceChange table ensured')
await client.end()
