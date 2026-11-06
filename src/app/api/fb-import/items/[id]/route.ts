import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { askableFacetsFor, rangeFacetsFor, typesFor, postableSubcategoriesFor } from '@/lib/taxonomy'
import { areaFromTyped } from '@/lib/fb-import/area'
import { IMPORT_CATEGORIES, textProblem, translateText, validChips, validShelf } from '@/lib/fb-import/sort'

export const dynamic = 'force-dynamic'

const edit = z.object({
  title: z.string().max(140).optional(),
  description: z.string().max(5000).optional(),
  price: z.number().int().min(0).max(1e12).nullable().optional(),
  district: z.string().trim().max(80).nullable().optional(),
  categorySlug: z.string().max(60).optional(),
  subcategorySlug: z.string().max(60).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  skip: z.boolean().optional(),
  /** The language of the text the seller edited (the one the review showed). The same field in the other language is translated at once. */
  lang: z.enum(['en', 'vi']).optional(),
})

// The seller's edits to a draft, checked as an import is: only a draft of their own, a shelf import offers, and chips the taxonomy has.
export const PATCH = route({ auth: 'userId', rateLimit: { bucket: 'fb-import-edit', limit: 600, window: '1 h' } }, async ({ req, userId, params }) => {
  const parsed = edit.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const b = parsed.data
  const item = await db.facebookImportItem.findFirst({ where: { id: params.id, job: { profileId: userId }, status: { in: ['draft', 'skipped'] } } })
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const categorySlug = b.categorySlug ?? item.categorySlug
  if (categorySlug && !IMPORT_CATEGORIES.includes(categorySlug)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const moved = b.categorySlug !== undefined && b.categorySlug !== item.categorySlug
  let subcategorySlug = b.subcategorySlug !== undefined ? b.subcategorySlug : moved ? null : item.subcategorySlug
  if (subcategorySlug && categorySlug && !postableSubcategoriesFor(categorySlug).some((s) => s.slug === subcategorySlug)) subcategorySlug = null
  // The same shelves an import may land on: a licence-checked aisle or a visa slot can't be reached by an edit either.
  if (categorySlug && !validShelf({ category: categorySlug, subcategory: subcategorySlug ?? '', listingType: moved ? undefined : item.listingType })) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const facets = categorySlug ? askableFacetsFor(categorySlug, subcategorySlug) : []
  const ranges = categorySlug ? rangeFacetsFor(categorySlug, subcategorySlug) : []
  const chips = b.attributes ? validChips(b.attributes, facets, ranges).attributes : moved ? {} : ((item.attributes as Record<string, string | string[]> | null) ?? {})
  // ⛔ AN EDIT IS SAVED IN THE LANGUAGE THE SELLER SAW, AND TRANSLATED AT ONCE (owner, 2026-11-06: two proper versions, Vietnamese and English). The
  // other language's same field gets the translation, or null when no AI answered, for Publish to fill (publish.ts bothLanguages). One field at a time,
  // so a title edited in one language and a description in the other each keep their own source (commit gate, codex + opus).
  const vi = b.lang === 'vi'
  const title = b.title ?? (vi ? item.titleVi ?? item.title : item.title ?? item.titleVi) ?? ''
  const description = b.description ?? (vi ? item.descriptionVi ?? item.description : item.description ?? item.descriptionVi) ?? ''
  const reason = textProblem(title, description)
  const other = vi ? 'en' : 'vi'
  // ⛔ STILL UNCLAIMED: a publish can take the row between the read above and here, and an edit must not hand it back.
  const done = await db.facebookImportItem.updateMany({
    where: { id: item.id, status: { in: ['draft', 'skipped'] } },
    // ⛔ ONLY WHAT THIS EDIT CHANGES: two fields saved at once each read the same row, and the second would write the first back to what it was.
    data: {
      // The seller's words first, the other language's field emptied (stale): the translation below fills it.
      ...(b.title !== undefined ? (vi ? { titleVi: title, title: null } : { title, titleVi: null }) : {}),
      ...(b.description !== undefined ? (vi ? { descriptionVi: description, description: null } : { description, descriptionVi: null }) : {}),
      ...(b.categorySlug !== undefined || b.subcategorySlug !== undefined || moved ? { categorySlug, subcategorySlug } : {}),
      ...(moved && categorySlug ? { listingType: typesFor(categorySlug)[0] } : {}),
      ...(b.attributes !== undefined || moved ? { attributes: chips as Prisma.InputJsonValue } : {}),
      ...(moved ? { specs: {} as Prisma.InputJsonValue } : {}),
      ...(b.price !== undefined ? { price: b.price } : {}),
      ...(b.district !== undefined ? areaFromTyped(b.district, item.city) : {}),
      ...(b.skip !== undefined ? { status: b.skip ? 'skipped' : 'draft' } : {}),
      reason: categorySlug ? reason : 'no_category',
    },
  })
  if (done.count !== 1) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // ⛔ THE TRANSLATION ONLY OVER THE WORDS IT CAME FROM (commit gate, codex + opus): a later edit to the same field, saved while this one waited on the AI,
  // must never be overwritten by the older text's translation. No AI answer leaves the gap for Publish to fill.
  for (const [kind, text] of [['title', b.title !== undefined ? title : null], ['description', b.description !== undefined ? description : null]] as const) {
    if (text === null) continue
    // At most 12 s each: behind Cloudflare a request dies at 100 s, and the seller's words are already saved; a slow answer is left for Publish (commit gate, opus).
    const translated = await Promise.race([translateText(text, kind, other), new Promise<null>((r) => setTimeout(() => r(null), 12_000))])
    if (!translated) continue
    const source = vi ? (kind === 'title' ? 'titleVi' : 'descriptionVi') : kind
    const target = vi ? kind : (kind === 'title' ? 'titleVi' : 'descriptionVi')
    await db.facebookImportItem.updateMany({ where: { id: item.id, status: { in: ['draft', 'skipped'] }, [source]: text }, data: { [target]: translated } })
  }
  return NextResponse.json({ id: item.id, status: b.skip !== undefined ? (b.skip ? 'skipped' : 'draft') : item.status, reason: categorySlug ? reason : 'no_category' }, { headers: { 'Cache-Control': 'no-store' } })
})
