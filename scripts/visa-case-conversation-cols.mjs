// PHASE 1 of the visa APPLY/MANAGE split — the schema foundation the external reviewers
// (GPT-5.6 + Gemini 3.1, 2026-07-23) said had to exist before the redesign is safe.
//
// Idempotent additive DDL over DIRECT_URL. The LEAD runs this; no app query names these
// columns until the Phase-1 code lands. All nullable, no FK — safe outside the
// profile_auth_fk push flow (same class as scripts/sold-attribution-cols.mjs).
//
// WHY (the two data-integrity holes it closes):
//  1. IMMUTABLE case↔conversation link. Today one buyer↔desk Conversation is REBOUND from
//     case to case (dm-thread.ts unbinds A before binding B). So Conversation.visaApplicationId
//     names only the LIVE case, and case A — once B starts — has no thread to receive its
//     result PDF (result delivery looks up by the live binding, fails, and DELETES the upload:
//     result_not_delivered). visa_applications.conversation_id fixes this: it is set ONCE and
//     never rebinds, so every case keeps a stable handle to the thread its cards live in.
//     Recoverable for ALL cases (not just the 2 currently bound) because there is exactly one
//     conversation per buyer↔desk — the backfill resolves it from buyerProfileId = user_id.
//  2. CANONICAL PRODUCT SELECTION. The chosen product is currently only a
//     'dm_product_selected' audit event ("newest wins"), which is not safe commercial state:
//     concurrent taps, equal-timestamp UUID ordering, non-atomic with the payload, and a
//     selection that can move the ETA after payment. These columns are the canonical record;
//     Phase-1 code writes them transactionally and FREEZES them at checkout.

import 'dotenv/config'
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL or DATABASE_URL.'); process.exit(1) }

const c = new pg.Client({ connectionString: url })

async function main() {
  await c.connect()

  // 1) Columns — additive, nullable, no FK. Text ids (Conversation.id is a cuid; listing id a cuid).
  await c.query(`
    alter table public.visa_applications
      add column if not exists conversation_id    text,
      add column if not exists selected_listing_id text,
      add column if not exists selected_entry_type text,
      add column if not exists selected_speed      text,
      add column if not exists selected_at         timestamptz
  `)

  // Index the lookup the dashboard + result delivery will do (by conversation, and by case).
  await c.query(`create index if not exists visa_applications_conversation_idx on public.visa_applications(conversation_id)`)

  // 2) Backfill conversation_id from the buyer↔desk conversation. One conversation per
  //    buyer↔seller, so this is deterministic even for cases whose live binding was rebound
  //    away. Prefer the row ALREADY bound to this case (exact), else the buyer's desk thread.
  const bound = await c.query(`
    update public.visa_applications va
       set conversation_id = c.id
      from "Conversation" c
     where c."visaApplicationId" = va.id
       and va.conversation_id is null
    returning va.id
  `)
  const byBuyer = await c.query(`
    update public.visa_applications va
       set conversation_id = c.id
      from "Conversation" c
      join "Seller" s on s.id = c."sellerId"
      join "Profile" p on p.id = s."ownerId"
     where c."buyerProfileId" = va.user_id
       and lower(p.email) in ('support@eno.forum', 'support@eno.vn')
       and va.conversation_id is null
    returning va.id
  `)

  // 3) Backfill the selected product from the newest dm_product_selected event per case,
  //    where one exists. entry_type comes from the decrypted payload at RUNTIME, not here
  //    (this script never decrypts) — Phase-1 code fills selected_entry_type on the next
  //    selection/checkout; a null here just means "resolve from the event/listing as before".
  const sel = await c.query(`
    with newest as (
      select distinct on (application_id)
             application_id,
             (metadata->>'listingId') as listing_id,
             (metadata->>'speed')     as speed,
             created_at
        from public.visa_events
       where event = 'dm_product_selected'
         and metadata ? 'listingId'
       order by application_id, created_at desc, id desc
    )
    update public.visa_applications va
       set selected_listing_id = n.listing_id,
           selected_speed      = coalesce(n.speed, va.selected_speed),
           selected_at         = n.created_at
      from newest n
     where n.application_id = va.id
       and va.selected_listing_id is null
    returning va.id
  `)

  const total = await c.query(`select count(*)::int n, count(conversation_id)::int linked, count(selected_listing_id)::int with_product from public.visa_applications`)
  const r = total.rows[0]
  console.log(`✓ columns in place. ${r.linked}/${r.n} cases linked to a conversation (${bound.rowCount} by binding, ${byBuyer.rowCount} by buyer↔desk); ${r.with_product} have a backfilled product (${sel.rowCount} newly).`)
  if (r.linked < r.n) console.warn(`⚠️ ${r.n - r.linked} case(s) have NO conversation — a case whose buyer has no desk thread. Phase-1 code must tolerate a null conversation_id.`)
}

main().then(() => c.end()).catch((e) => { console.error(e); c.end(); process.exit(1) })
