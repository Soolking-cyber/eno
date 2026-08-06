import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { updateSellerCore } from '@/lib/core/seller'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A seller edits their OWN storefront (business profile). auth → core → respond; the edit
// logic is the shared updateSellerCore (also used by the partner PATCH /api/v1/shop).
//
// ⚠️ WS6 MIGRATION — auth preamble only. 401 `auth_required`, 403 `no_storefront`, 400 `Invalid body`
// and every `{status, error}` pair updateSellerCore chooses are unchanged.
//
// ⚠️ `auth: 'profile'`: the old code called `getCurrentProfile()`. Only `profile.id` is used, but
// that call also lazily provisions the row, and updateSellerCore writes against the owner id.
//
// ⚠️ NO `body:` SCHEMA, AND THE CORE'S ERRORS STAY A RAW Response. Malformed JSON answers
// `{"error":"Invalid body"}`, which is not an ApiErrorCode. updateSellerCore returns a plain
// `{ code, error: string }` whose vocabulary is wider than ApiErrorCode (`bad_tax_code`,
// `no_phone_in_profile` are not in errors.ts) — forwarding it as a Response keeps those strings on
// the wire exactly as they are instead of forcing a rename. Reported, not added.
//
// ⚠️ Branch ORDER is preserved: storefront lookup BEFORE the body parse, so a seller-less caller who
// also sends garbage still gets 403 `no_storefront`, not 400.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: nothing wrapped the Prisma read or updateSellerCore, so a DB
// rejection was an unhandled throw and Next answered its own default 500. route() now catches it and
// returns `{"error":"internal_error"}` 500 — an improvement, but a wire change on the failure path.
export const PATCH = route({ auth: 'profile' }, async ({ req, profile }) => {
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!seller) throw new ApiError('no_storefront', 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const res = await updateSellerCore(seller.id, profile.id, body)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.code })
  return { ok: true }
})
