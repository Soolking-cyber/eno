import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TAXONOMY, LISTING_TYPES, categoryHasBrand } from '@/lib/taxonomy'
import { route } from '@/lib/api/handler'

// Lightweight taxonomy read for client surfaces that can't receive categories
// as server props (the account panel's bulk-upload section, the native iOS
// app's subcategory chips + post wizard). Slug + names, each category's
// subcategories, and — for the native wizard — the category's listing types,
// facet definitions (chips + ranges, incl. the condition toggle, each carrying
// whether it blocks publish), and whether brand/model fields apply. Every facet
// field is normalised here (no undefined on the wire), which is also what keeps
// the payload additive. All from the canonical code TAXONOMY (they aren't
// DB rows); changes only on taxonomy edits, so let the CDN hold it.
//
// ⚠️ WS6 MIGRATION. `auth: 'public'` — this is anonymous reference data and always was; there was no
// auth block to replace. What the wrapper actually buys here is the error boundary: the one DB read
// (`db.category.findMany`) had no try/catch, so a Prisma failure was an unhandled throw and Next's
// own default 500. It is now `{"error":"internal_error"}` 500, logged with an `op`. That is the
// migration's one accepted wire change and it is on the failure path only.
//
// ⚠️ THE SUCCESS BODY IS RETURNED AS A `NextResponse`, NOT A PLAIN OBJECT, and it has to be: the
// Cache-Control header IS the contract for this route (the whole reason it is cheap), and route()'s
// plain-object path serialises with no headers. Returning the Response escapes to it verbatim.
export const GET = route({ auth: 'public' }, async () => {
  const categories = await db.category.findMany({
    orderBy: { name: 'asc' },
    select: { slug: true, name: true, nameVi: true },
  })
  const typeLabel = new Map(LISTING_TYPES.map((t) => [t.value, t]))
  const metaBySlug = new Map(
    TAXONOMY.map((c) => [
      c.slug,
      {
        subcategories: c.subcategories.map((s) => ({ slug: s.slug, name: s.name, nameVi: s.nameVi, icon: s.icon })),
        types: c.types.map((v) => {
          const t = typeLabel.get(v)
          return { value: v, label: t?.label ?? v, labelVi: t?.labelVi ?? v }
        }),
        brandable: categoryHasBrand(c.slug),
        facets: c.facets.map((f) => ({
          key: f.key,
          label: f.label,
          labelVi: f.labelVi,
          kind: f.kind ?? 'select',
          subcats: f.subcats ?? null,
          // Whether a client may publish WITHOUT this facet — the wire form of
          // FacetDef.optional / isRequiredFacet(). Without it the native post gate
          // can only infer "every non-range facet of the chosen subcategory is
          // required", which is right for condition/transmission but wrong for
          // services/visa-legal: that subcategory also holds work-permit, tax and
          // legal listings, and an ordinary seller must not be blocked by an e-visa
          // entry-type or processing-speed chip (owner's launch-leniency policy).
          // Normalised to a real boolean, like `kind`/`subcats`/`range` above, so a
          // client never has to distinguish absent from false. ADDITIVE: a client
          // that ignores the key keeps today's behaviour exactly (false = required,
          // which is what it already assumes) — Swift Codable and the Android
          // `Json { ignoreUnknownKeys = true }` both drop unmodelled keys.
          optional: f.optional === true,
          options: f.options.map((o) => ({ value: o.value, label: o.label, labelVi: o.labelVi })),
          range: f.range
            ? { min: f.range.min, max: f.range.max, step: f.range.step, unit: f.range.unit ?? null, column: f.range.column }
            : null,
        })),
      },
    ]),
  )
  return NextResponse.json(
    {
      categories: categories.map((c) => ({
        ...c,
        subcategories: metaBySlug.get(c.slug)?.subcategories ?? [],
        types: metaBySlug.get(c.slug)?.types ?? [],
        brandable: metaBySlug.get(c.slug)?.brandable ?? false,
        facets: metaBySlug.get(c.slug)?.facets ?? [],
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } },
  )
})
