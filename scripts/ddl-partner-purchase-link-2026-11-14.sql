-- PartnerPurchaseLink: the staff-only purchase links of eno-run partner listings (owner 2026-11-14).
-- Additive only: one new empty table + its FK to "Listing" (ON DELETE CASCADE) + RLS on. Matches
-- `prisma migrate diff` (old schema → new) exactly, plus ENABLE ROW LEVEL SECURITY.
-- APPLIED to production 2026-11-14 (owner; rls-guard after: no RLS-off table, relrowsecurity = t).
-- Run:  psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/ddl-partner-purchase-link-2026-11-14.sql
--       then scripts/rls-guard.sql (proves no public relation is exposed).
BEGIN;
CREATE TABLE "PartnerPurchaseLink" (
    "listingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerPurchaseLink_pkey" PRIMARY KEY ("listingId")
);
ALTER TABLE "PartnerPurchaseLink" ADD CONSTRAINT "PartnerPurchaseLink_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerPurchaseLink" ENABLE ROW LEVEL SECURITY;
COMMIT;
